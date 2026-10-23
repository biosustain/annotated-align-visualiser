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

// Tick labels show only the called base(s). The basecall text from the file
// starts with its trace index ("11:A"), which is shown in the tooltips instead.
const basecallIndexOf = basecall => basecall.slice(0, basecall.indexOf(':'))

const basecallLetters = data => {
    return data.gappedTrace.basecallPos.map(pos => {
        const basecall = data.gappedTrace.basecalls[pos]
        return basecall.slice(basecall.indexOf(':') + 1)
    })
}

const referenceLetters = data => {
    return data.gappedTrace.basecallPos.map((_, index) =>
        data.refalign[index + data.gappedTrace.leadingGaps])
}

// Two-line tick labels: the called base, with the aligned reference base below.
export const buildBasecallTickText = data => {
    const calledBases = basecallLetters(data)
    const referenceBases = referenceLetters(data)
    return calledBases.map((calledBase, index) =>
        `${calledBase}<br>${referenceBases[index]}`)
}

const refPositionAtBasecallIndex = (refPositions, basecallIndex) => {
    const lastIndex = refPositions.length - 1
    if (basecallIndex > lastIndex) {
        return refPositions[lastIndex] + (basecallIndex - lastIndex)
    }
    return refPositions[basecallIndex]
}

// Every trace draws a basecall one sample before its basecallPos.
export const basecallXsOf = data =>
    data.gappedTrace.basecallPos.map(pos => pos - 1)

export const translateMainAxisRangeToAnnotation = (data, [start, end]) => {
    const basecallXs = basecallXsOf(data)
    const refPositions = buildBasecallRefPositions(data)
    const traceLength = basecallXs.length
    let startIndex = 0
    while (startIndex < traceLength && basecallXs[startIndex] < start) {
        startIndex++
    }
    let endIndex = startIndex
    while (endIndex < traceLength && basecallXs[endIndex] < end) {
        endIndex++
    }
    return [
        refPositionAtBasecallIndex(refPositions, startIndex),
        refPositionAtBasecallIndex(refPositions, endIndex)
    ]
}

export const translateAnnotationRangeToMainAxis = (data, [start, end]) => {
    const basecallXs = basecallXsOf(data)
    const refPositions = buildBasecallRefPositions(data)
    const lastIndex = basecallXs.length - 1
    const indexOfRefPosition = refPosition => {
        const index = refPositions.findIndex(position => position >= refPosition)
        return index === -1 ? lastIndex : index
    }
    return [
        basecallXs[indexOfRefPosition(start)],
        basecallXs[indexOfRefPosition(end)]
    ]
}

// A box is centred on its basecall and reaches halfway to the nearer
// neighbour on both sides, so it never overlaps a neighbouring box. The first
// and last basecalls only have one neighbour to go by.
const basecallBoxWidth = (basecallXs, basecallIndex) => {
    const x = basecallXs[basecallIndex]
    const previousX = basecallXs[basecallIndex - 1]
    const nextX = basecallXs[basecallIndex + 1]

    const neighbourDistances = []
    if (previousX !== undefined) neighbourDistances.push(x - previousX)
    if (nextX !== undefined) neighbourDistances.push(nextX - x)

    // A lone basecall has no neighbour; give it one sample.
    return neighbourDistances.length > 0 ? Math.min(...neighbourDistances) : 1
}

// The reference letters are the second line of each tick label. These are
// pixel offsets below the x-axis line spanning that line.
const REFERENCE_ROW_TOP_PX = 16
export const REFERENCE_ROW_BOTTOM_PX = 34

const MISMATCH_COLOR = 'rgba(200,0,0,.6)'
const SECONDARY_MATCH_COLOR = 'rgba(200,150,0,.6)'

// Coloured cells below the axis, running from the axis line through the
// basecall and reference letters. They share the bar colours, so a toggled-on
// bar and its cell read as one highlight. All cells of one colour form a single
// path shape: Plotly redraws every shape on each pan, and hundreds of separate
// shapes made panning noticeably slower.
const referenceCellsShape = (basecallXs, basecallIndexes, color) => {
    const top = 0
    const bottom = -REFERENCE_ROW_BOTTOM_PX
    const cellPaths = basecallIndexes.map(basecallIndex => {
        const x = basecallXs[basecallIndex]
        const halfWidth = basecallBoxWidth(basecallXs, basecallIndex) / 2
        const left = x - halfWidth
        const right = x + halfWidth
        return `M ${left},${top} L ${right},${top} L ${right},${bottom} L ${left},${bottom} Z`
    })

    return {
        type: 'path',
        path: cellPaths.join(' '),
        xref: 'x',
        yref: 'paper',
        ysizemode: 'pixel',
        yanchor: 0,
        fillcolor: color,
        line: { width: 0 },
        layer: 'below'
    }
}

// Reference positions (1-based, inclusive) of the first and last base in view,
// shown at either end of the reference row.
export const referenceRangeLabels = (data, xRange) => {
    const [startPosition, endPosition] =
        translateMainAxisRangeToAnnotation(data, xRange)
    // Past the last base both ends extrapolate to the same position, which
    // would put the start one after the end.
    const start = Math.min(startPosition + 1, endPosition)
    return { start, end: endPosition }
}

// The start and end labels are the first two layout annotations; main.js
// updates their text on zoom.
export const REFERENCE_ROW_START_LABEL_INDEX = 0
export const REFERENCE_ROW_END_LABEL_INDEX = 1

// Annotation sitting just outside the plot, level with the reference row.
const referenceRowEndLabel = (side, text) => ({
    xref: 'paper',
    x: side === 'start' ? 0 : 1,
    xanchor: side === 'start' ? 'right' : 'left',
    xshift: side === 'start' ? -6 : 6,
    yref: 'paper',
    y: 0,
    yshift: -(REFERENCE_ROW_TOP_PX + REFERENCE_ROW_BOTTOM_PX) / 2,
    yanchor: 'middle',
    text: `${text}`,
    showarrow: false,
    font: { family: 'monospace', size: 12 }
})

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
        customdata: raw_data.gappedTrace.basecallPos.map(
            pos => raw_data.gappedTrace.basecalls[pos]),
        hovertemplate: 'Basecall %{customdata}<br>Quality %{y}<extra></extra>',
        yaxis: 'y2',
        type: 'bar',
        xaxis: 'x2',
        marker: {
            color: decom.map(([_, prim]) => basecallColorMap[prim]),
        },
        visible: 'legendonly'
    })

    // Collect the basecall index of each mismatch, by type
    const noMatchIndexes = [];
    const secondaryMatchIndexes = [];

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
                    secondaryMatchIndexes.push(index);
                } else {
                    // No match
                    noMatchIndexes.push(index);
                }
            }
        }
    });

    const allBasecallXs = basecallXsOf(raw_data)

    const buildMatchBarTrace = (name, basecallIndexes, color) => {
        return {
            name,
            x: basecallIndexes.map(index => allBasecallXs[index]),
            width: basecallIndexes.map(index => basecallBoxWidth(allBasecallXs, index)),
            y: basecallIndexes.map(() => 1),
            hoverinfo: 'x+name',
            type: 'bar',
            xaxis: 'x2',
            marker: { color },
            yaxis: 'y3',
            visible: 'legendonly'
        }
    }

    data.push(buildMatchBarTrace('Mismatches', noMatchIndexes, MISMATCH_COLOR));
    data.push(buildMatchBarTrace('Secondary Match', secondaryMatchIndexes, SECONDARY_MATCH_COLOR));

    const refPositions = buildBasecallRefPositions(raw_data)
    const basecallPos = raw_data.gappedTrace.basecallPos
    const calledBases = basecallLetters(raw_data)
    const referenceBases = referenceLetters(raw_data)

    const referenceCellShapes = [
        referenceCellsShape(allBasecallXs, noMatchIndexes, MISMATCH_COLOR),
        referenceCellsShape(allBasecallXs, secondaryMatchIndexes, SECONDARY_MATCH_COLOR)
    ].filter(shape => shape.path !== '')

    // Plotly cannot attach tooltips to axis tick labels, so invisible markers
    // along the bottom edge of the plot, above each tick, carry the tooltip.
    data.push({
        name: 'Basecall',
        x: basecallPos.map(pos => pos - 1),
        y: basecallPos.map(() => 0),
        text: calledBases,
        customdata: basecallPos.map((pos, index) => [
            refPositions[index] + 1,
            basecallIndexOf(raw_data.gappedTrace.basecalls[pos]),
            referenceBases[index]
        ]),
        mode: 'markers',
        type: 'scatter',
        xaxis: 'x2',
        yaxis: 'y3',
        marker: { size: 16, opacity: 0 },
        hovertemplate: 'Basecall %{text}<br>' +
            'Basecall index %{customdata[1]}<br>' +
            'Reference sequence position %{customdata[0]}<br>' +
            'Reference %{customdata[2]}<extra></extra>',
        showlegend: false
    })

    // The view opens on the first aligned bases.
    const window_size = 20
    const lastBasecallIndex = basecallPos.length - 1
    const ref_pos_range = [
        basecallPos[0],
        basecallPos[Math.min(2 * window_size, lastBasecallIndex)]
    ].map(pos => pos - 1)

    const {
        traces: annotationTraces,
        yaxes: annotationYAxes,
        shapes: annotationShapes
    } = buildAnnotationFigureData(annotationData)
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

    const initialReferenceLabels = referenceRangeLabels(raw_data, ref_pos_range)

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
            // Mismatch bars are 1 high, so they fill the plot height exactly.
            range: [0, 1],
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
            // Same `pos - 1` x as the basecall and reference traces, so the
            // tick labels line up with the reference bases.
            tickvals: raw_data.gappedTrace.basecallPos.map(pos => pos - 1),
            ticktext: buildBasecallTickText(raw_data),
            rangeslider: {
                visible: true
            },
            minallowed: 0,
            tickangle: 0
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
            ...referenceCellShapes,
            ...annotationShapes
        ],
        // Order must match the REFERENCE_ROW_*_LABEL_INDEX constants.
        annotations: [
            referenceRowEndLabel('start', initialReferenceLabels.start),
            referenceRowEndLabel('end', initialReferenceLabels.end)
        ],
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
