import { getYOffsetsForPotentiallyCircularRanges } from "@teselagen/range-utils";
import { annotationTypes } from "@teselagen/sequence-utils";

const buildAnnotationFigureData = annotationData => {
    const yaxes = []
    const traces = []

    if (!annotationData) {
        return { traces, yaxes }
    }

    let yaxisIdx = 3
    for (const annotationType of annotationTypes) {
        const annotations = annotationData[annotationType]
        if (!annotations) continue

        yaxisIdx++
        const { maxYOffset } = getYOffsetsForPotentiallyCircularRanges(annotations)
        const barTrace = annotationsToBarTrace(annotations)
        traces.push({
            ...barTrace,
            xaxis: 'x3',
            yaxis: `y${yaxisIdx}`,
            name: annotationType,
        })
        yaxes.push({
            title: {
                text: annotationType
            },
            showgrid: false,
            zeroline: false,
            visible: false,
            range: [-maxYOffset - 0.5, 0.5],
            _index: yaxisIdx
        })
    }

    return { traces, yaxes }
}

const buildAxisDomains = annotationAxisCount => {
    const mainPlotDomain = annotationAxisCount > 0 ? [0, 0.55] : [0, 1]
    if (annotationAxisCount === 0) {
        return { mainPlotDomain, annotationDomains: [] }
    }

    const annotationSectionStart = mainPlotDomain[1]
    const annotationSectionHeight = 1 - annotationSectionStart
    const annotationDomains = Array.from({ length: annotationAxisCount }, (_, index) => {
        const start = annotationSectionStart + (index / annotationAxisCount) * annotationSectionHeight
        const end = annotationSectionStart + ((index + 1) / annotationAxisCount) * annotationSectionHeight
        return [start, end]
    })

    return { mainPlotDomain, annotationDomains }
}


export const translateMainAxisRangeToAnnotation = (data, [start, end]) => {
    const { refpos, gappedTrace: { basecallPos } } = data
    let annotationStart = 0;
    const traceLength = basecallPos.length
    while(annotationStart <= traceLength && basecallPos[annotationStart] < start) {
        annotationStart++
    }
    let annotationEnd = annotationStart
    while(annotationEnd <= traceLength && basecallPos[annotationEnd] < end) {
        annotationEnd++
    }
    return [
        annotationStart + refpos,
        annotationEnd + refpos
    ]
}

export const translateAnnotationRangeToMainAxis = (data, [start, end]) => {
    const { refpos, gappedTrace: { basecallPos } } = data
    const traceLength = basecallPos.length
    return [
        basecallPos[Math.min(start - refpos, traceLength - 1)],
        basecallPos[Math.min(end - refpos, traceLength - 1)]
    ]
}

export const renderAlignment = (figure, raw_data, Plotly, annotationData = null) => {
    const colorMapFactory = opacity => ({
        A: `rgba(0,255,0,${opacity})`,
        C: `rgba(0,0,255,${opacity})`,
        G: `rgba(0,0,0,${opacity})`,
        T: `rgba(255,0,0,${opacity})`
    });
    const colorMap = colorMapFactory(1)

    const data = ['peakA', 'peakC', 'peakG', 'peakT'].map(peak => ({
        name: peak.at(-1), y: raw_data.gappedTrace[peak], line: { color: colorMap[peak.at(-1)], shape: 'linear' },
        type: 'scatter'
    }));

    const decom = raw_data.gappedTrace.basecallPos.map(pos =>
        raw_data.gappedTrace.basecalls[pos].split(/\W/));

    const basecallColorMap = colorMapFactory(0.3);

    data.push({
        name: 'basecall',
        x: raw_data.gappedTrace.basecallPos.map(pos => pos - 1),
        y: raw_data.gappedTrace.basecallQual,
        // text: decom.map(([_, prim]) => prim),
        yaxis: 'y2',
        type: 'bar',
        xaxis: 'x2',
        marker: {
            color: decom.map(([_, prim]) => basecallColorMap[prim]),
        },
        visible: 'legendonly'
    })

    // Collect mismatch positions by type
    const noMatchPositions = [];
    const secondaryMatchPositions = [];

    raw_data.gappedTrace.basecallPos.forEach((pos, index) => {
        const text = raw_data.gappedTrace.basecalls[pos];
        const align = raw_data.refalign[index + raw_data.gappedTrace.leadingGaps];
        if (align) {
            const decom = text.split(/\W/);
            const prim = decom[1];
            const sec = decom[2] ?? decom[1];
            if (!(align == prim && align == sec)) {
                if (align == prim || align == sec) {
                    // Secondary match
                    secondaryMatchPositions.push(pos - 1);
                } else {
                    // No match
                    noMatchPositions.push(pos - 1);
                }
            }
        }
    });

    // Add mismatch bars as traces
    data.push({
        name: 'Mismatches',
        x: noMatchPositions,
        y: noMatchPositions.map(() => 1),
        type: 'bar',
        xaxis: 'x2',
        marker: { color: 'rgba(200,0,0,.6)' },
        yaxis: 'y3',
        hoverinfo: 'x+name',
        visible: 'legendonly'
    });

    data.push({
        name: 'Secondary Match',
        x: secondaryMatchPositions,
        y: secondaryMatchPositions.map(() => 1),
        type: 'bar',
        xaxis: 'x2',
        marker: { color: 'rgba(200,150,0,.6)' },
        yaxis: 'y3',
        hoverinfo: 'x+name',
        visible: 'legendonly'
    });

    const window_size = 20;
    const ref_pos_range = [
        Math.max(0, (raw_data.refpos - window_size) ?? 0),
        Math.max(0, (raw_data.refpos + window_size) ?? -1)
    ].map(pos => raw_data.gappedTrace.basecallPos.at(pos) - 1);
    const ref_pos = raw_data.gappedTrace.basecallPos.at(raw_data.refpos) - 1;

    const { traces: annotationTraces, yaxes: annotationYAxes } = buildAnnotationFigureData(annotationData)
    data.push(...annotationTraces)

    const { mainPlotDomain, annotationDomains } = buildAxisDomains(annotationYAxes.length)

    const updatemenus = [{
        type: 'buttons',
        name: 'hscale',
        direction: 'left',
        xanchor: 'left',
        yanchor: 'bottom',
        y: 1.05,
        x: 0,
        buttons: [{
            label: '↺',
            method: 'relayout',
            args: [{
                'xaxis.range': ref_pos_range
            }]
        }],
    }];

    const layout = {
        title: (raw_data.refchr ?? 'Unnamed') + (raw_data.forward ? ' - forward' : ' - reverse'),
        yaxis: {
            type: 'linear',
            domain: mainPlotDomain,
            fixedrange: true,
        },
        yaxis2: {
            title: 'Basecall quality',
            overlaying: 'y',
            side: 'right',
            fixedrange: true,
            anchor: 'y'
        },
        yaxis3: {
            overlaying: 'y',
            side: 'right',
            showgrid: false,
            zeroline: false,
            visible: false,
            fixedrange: true,
            anchor: 'y'
        },
        legend: {
            orientation: 'h',
            xanchor: 'right',
            y: 1.05,
            x: 1
        },
        xaxis: {
            range: [...ref_pos_range],
            tickmode: 'array',
            tickvals: raw_data.gappedTrace.basecallPos,
            ticktext: raw_data.gappedTrace.basecallPos.map(pos => raw_data.gappedTrace.basecalls[pos]),
            rangeslider: {
                visible: true
            },
            minallowed: 0,
            tickangle: 90
        },
        xaxis2: {
            visible: false,
            matches: 'x',
            overlaying: 'x',
        },
        xaxis3: {
            visible: false,
            range: translateMainAxisRangeToAnnotation(raw_data, ref_pos_range),
        },
        shapes: [
            {
                type: 'line',
                x0: ref_pos,
                y0: 0,
                x1: ref_pos,
                yref: 'paper',
                y1: 1,
                line: {
                    color: 'red',
                    width: 1.5,
                    dash: 'dot'
                }
            }
        ],
        annotations: [{
            x: ref_pos,
            y: 1,
            xref: 'x',
            yref: 'paper',
            text: 'ref position',
            showarrow: false,
            xanchor: 'center',
            yanchor: 'bottom',
            ax: 0,
            ay: -40,
            font: {
                color: 'red'
            }
        }],
        ...Object.fromEntries(annotationYAxes.map((axis, index) => [
            `yaxis${axis._index}`,
            {
                ...axis,
                domain: annotationDomains[index],
                anchor: 'x',
                fixedrange: true,
            }
        ])),
        updatemenus,
        grid: {
            rows: 5,
            columns: 1,
            subplots: [['x3y5'], ['xy']],
        }
    };

    const config = { responsive: true };

    Plotly.react(figure, data, layout, config);
}

const annotationsToBarTrace = (annotations) => {
    const x = [];
    const y = [];
    const base = [];
    const color = [];
    const text = [];

    for (const annotation of annotations) {
        x.push(annotation.end - annotation.start);
        y.push(-annotation.yOffset);
        base.push(annotation.start);
        if (annotation.notes) {
            if (annotation.forward && annotation.notes.ApEinfo_fwdcolor) {
                color.push(annotation.notes.ApEinfo_fwdcolor[0])
            } else if (!annotation.forward && annotation.notes.ApEinfo_revcolor) {
                color.push(annotation.notes.ApEinfo_revcolor[0])
            } else {
                color.push('rgba(0,0,255,0.5)'); // default color
            }
        } else {
            color.push('rgba(0,0,255,0.5)'); // default color
        }
        text.push(annotation.name);
    }
    return {
        x, y, base, text, type: 'bar', orientation: 'h', marker: { color },
        hovertemplate: '%{text} [%{base} - %{x}]'
    };
}