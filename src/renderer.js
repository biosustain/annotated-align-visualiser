import { getYOffsetsForPotentiallyCircularRanges } from "@teselagen/range-utils";
import { annotationTypes } from "@teselagen/sequence-utils";

const buildAnnotationFigureData = annotationData => {
    const yaxes = []
    const traces = []
    const shapes = []

    if (!annotationData) {
        return { traces, yaxes, shapes }
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
        shapes.push(...annotations.map(annotation =>
            annotationToArrowShape(annotation, `y${yaxisIdx}`)))
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

    return { traces, yaxes, shapes }
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


// Reference position (0-based) of every basecall. Each alignment column maps
// to refpos plus the number of reference bases before it, so `-` gaps in the
// reference row do not advance the index.
export const buildBasecallRefPositions = ({ refpos, refalign, gappedTrace }) => {
    const refPositionByColumn = []
    let nextRefPosition = refpos
    for (const base of refalign) {
        refPositionByColumn.push(nextRefPosition)
        if (base !== '-') {
            nextRefPosition++
        }
    }

    return gappedTrace.basecallPos.map((_, basecallIndex) =>
        refPositionByColumn[basecallIndex + gappedTrace.leadingGaps])
}

const refPositionAtBasecallIndex = (refPositions, basecallIndex) => {
    const lastIndex = refPositions.length - 1
    if (basecallIndex > lastIndex) {
        return refPositions[lastIndex] + (basecallIndex - lastIndex)
    }
    return refPositions[basecallIndex]
}

export const translateMainAxisRangeToAnnotation = (data, [start, end]) => {
    const { gappedTrace: { basecallPos } } = data
    const refPositions = buildBasecallRefPositions(data)
    const traceLength = basecallPos.length
    let startIndex = 0
    while (startIndex < traceLength && basecallPos[startIndex] < start) {
        startIndex++
    }
    let endIndex = startIndex
    while (endIndex < traceLength && basecallPos[endIndex] < end) {
        endIndex++
    }
    return [
        refPositionAtBasecallIndex(refPositions, startIndex),
        refPositionAtBasecallIndex(refPositions, endIndex)
    ]
}

export const translateAnnotationRangeToMainAxis = (data, [start, end]) => {
    const { gappedTrace: { basecallPos } } = data
    const refPositions = buildBasecallRefPositions(data)
    const lastIndex = basecallPos.length - 1
    const indexOfRefPosition = refPosition => {
        const index = refPositions.findIndex(position => position >= refPosition)
        return index === -1 ? lastIndex : index
    }
    return [
        basecallPos[indexOfRefPosition(start)],
        basecallPos[indexOfRefPosition(end)]
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

    const refPositions = buildBasecallRefPositions(raw_data)
    const basecallPos = raw_data.gappedTrace.basecallPos

    data.push({
        name: 'Reference',
        x: basecallPos.map(pos => pos - 1),
        y: basecallPos.map(() => 0.03),
        text: basecallPos.map((_, index) => raw_data.refalign[index + raw_data.gappedTrace.leadingGaps]),
        customdata: refPositions.map(position => position + 1),
        mode: 'text',
        type: 'scatter',
        xaxis: 'x2',
        yaxis: 'y3',
        textfont: { family: 'monospace', size: 12 },
        hovertemplate: 'ref position %{customdata}<extra></extra>',
        showlegend: false
    })

    // The marker sits on the first aligned base; the view opens around it.
    const window_size = 20
    const lastBasecallIndex = basecallPos.length - 1
    const ref_pos_range = [
        basecallPos[0],
        basecallPos[Math.min(2 * window_size, lastBasecallIndex)]
    ].map(pos => pos - 1)
    const ref_pos = basecallPos[0] - 1

    const { traces: annotationTraces, yaxes: annotationYAxes, shapes: annotationShapes } = buildAnnotationFigureData(annotationData)
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
            range: [0, 1.05],
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
            // Its drag strip would otherwise overlap the subplot below and
            // swallow that subplot's hover events.
            fixedrange: true,
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
            },
            ...annotationShapes
        ],
        annotations: [{
            x: ref_pos,
            y: 1,
            xref: 'x',
            yref: 'paper',
            text: `ref position ${refPositions[0] + 1}`,
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
        // The default 'x' mode matches on x only, so annotations stacked in
        // other rows at the same x never get a tooltip.
        hovermode: 'closest',
        grid: {
            rows: annotationYAxes.length + 1,
            columns: 1,
            // Every annotation subplot must be declared or it gets no hover.
            subplots: [
                ...annotationYAxes.map(axis => [`x3y${axis._index}`]),
                ['xy']
            ],
        }
    };

    const config = { responsive: true };

    Plotly.react(figure, data, layout, config);
}

const DEFAULT_ANNOTATION_COLOR = 'rgba(0,0,255,0.5)'
const ARROW_HEAD_LENGTH = 10
const ARROW_HALF_HEIGHT = 0.4

const annotationColor = annotation => {
    const colors = annotation.notes?.[annotation.forward ? 'ApEinfo_fwdcolor' : 'ApEinfo_revcolor']
    return colors?.[0] ?? DEFAULT_ANNOTATION_COLOR
}

// A box whose tip points right on the plus strand and left on the minus strand.
const annotationToArrowShape = (annotation, yref) => {
    const { start, end } = annotation
    const centerY = -annotation.yOffset
    const top = centerY + ARROW_HALF_HEIGHT
    const bottom = centerY - ARROW_HALF_HEIGHT
    const headLength = Math.min(ARROW_HEAD_LENGTH, (end - start) / 2)

    const path = annotation.forward
        ? `M ${start},${bottom} L ${end - headLength},${bottom} L ${end},${centerY} L ${end - headLength},${top} L ${start},${top} Z`
        : `M ${end},${bottom} L ${start + headLength},${bottom} L ${start},${centerY} L ${start + headLength},${top} L ${end},${top} Z`

    return {
        type: 'path',
        path,
        xref: 'x3',
        yref,
        fillcolor: annotationColor(annotation),
        line: { width: 0 },
        layer: 'above'
    }
}

const annotationsToBarTrace = (annotations) => {
    const x = []
    const y = []
    const base = []
    const color = []
    const customdata = []

    for (const annotation of annotations) {
        x.push(annotation.end - annotation.start)
        y.push(-annotation.yOffset)
        base.push(annotation.start)
        color.push(annotationColor(annotation))
        customdata.push([
            annotation.name ?? annotation.type ?? 'unnamed',
            annotation.id ?? 'n/a',
            // GenBank coordinates: 1-based, inclusive
            annotation.start + 1,
            annotation.end,
            annotation.forward ? 'plus (+)' : 'minus (-)'
        ])
    }

    // The visible box is drawn as an arrow shape; the bars stay for hover and click.
    return {
        x, y, base, customdata, type: 'bar', orientation: 'h',
        marker: { color, opacity: 0 },
        hovertemplate: '<b>%{customdata[0]}</b><br>ID: %{customdata[1]}<br>' +
            'Coordinates: %{customdata[2]}..%{customdata[3]}<br>' +
            'Strand: %{customdata[4]}<extra></extra>'
    }
}
