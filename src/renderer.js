import { getYOffsetsForPotentiallyCircularRanges } from "@teselagen/range-utils";
import { annotationTypes } from "@teselagen/sequence-utils";

// Gives every annotation the track row (yOffset) it is drawn on and returns
// the last row. range-utils reads range ends as inclusive, while ends here are
// exclusive; passed as they are, features that only touch would be stacked as
// if they overlapped.
const stackAnnotationRows = annotations => {
    const inclusiveRanges = annotations.map(annotation =>
        ({ start: annotation.start, end: annotation.end - 1 }))
    const { yOffsets, maxYOffset } =
        getYOffsetsForPotentiallyCircularRanges(inclusiveRanges)
    annotations.forEach((annotation, index) => {
        annotation.yOffset = yOffsets[index]
    })
    return maxYOffset
}

const buildAnnotationFigureData = (annotationData, viewRange, basesPerPixel) => {
    const yaxes = []
    const traces = []
    const shapes = []
    const labels = []
    const trackRowCounts = []

    if (!annotationData) {
        return { traces, yaxes, shapes, labels, trackRowCounts }
    }

    let yaxisIdx = 3
    for (const annotationType of annotationTypes) {
        const annotations = annotationData[annotationType]
        if (!annotations) continue

        yaxisIdx++
        const maxYOffset = stackAnnotationRows(annotations)
        const barTrace = annotationsToBarTrace(annotations)
        traces.push({
            ...barTrace,
            xaxis: 'x3',
            yaxis: `y${yaxisIdx}`,
            name: annotationType,
        })
        shapes.push(...annotations.map(annotation =>
            annotationToArrowShape(annotation, `y${yaxisIdx}`, basesPerPixel)))
        labels.push(...annotations.map(annotation => annotationToLabel(
            annotation, `y${yaxisIdx}`, viewRange, basesPerPixel)))
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
        trackRowCounts.push(maxYOffset + 1)
    }

    return { traces, yaxes, shapes, labels, trackRowCounts }
}


// Reference position (0-based) of every basecall. Each alignment column maps
// to refpos plus the number of reference bases before it, so `-` gaps in the
// reference row do not advance the index. tracy writes refpos 1-based.
export const buildBasecallRefPositions = ({ refpos, refalign, gappedTrace }) => {
    const refPositionByColumn = []
    let nextRefPosition = refpos - 1
    for (const base of refalign) {
        refPositionByColumn.push(nextRefPosition)
        if (base !== '-') {
            nextRefPosition++
        }
    }

    return gappedTrace.basecallPos.map((_, basecallIndex) =>
        refPositionByColumn[basecallIndex + gappedTrace.leadingGaps])
}

// A feature that never reaches the aligned bases can never come into view, yet
// it would still take a row in its track and push the others down. Features
// running past either end are kept and cut off at the edge of the view.
export const annotationsInAlignedRegion = (annotationData, data) => {
    if (!annotationData) {
        return null
    }

    const refPositions = buildBasecallRefPositions(data)
    const regionStart = refPositions[0]
    const regionEnd = refPositions.at(-1) + 1
    const overlapsRegion = annotation =>
        annotation.start < regionEnd && annotation.end > regionStart

    const inRegion = {}
    for (const annotationType of annotationTypes) {
        const annotations = (annotationData[annotationType] ?? []).filter(overlapsRegion)
        if (annotations.length > 0) {
            inRegion[annotationType] = annotations
        }
    }
    return inRegion
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

// The page sizes the plot for the trace alone; annotation tracks add to that.
export const BASE_FIGURE_HEIGHT_PX = 600
// Plotly's default margins. Track heights are worked out from the plot
// height, so the layout sets them rather than relying on the defaults.
const FIGURE_MARGIN_TOP_PX = 100
const FIGURE_MARGIN_BOTTOM_PX = 80
// The range slider's default height in the base figure. Plotly would grow it
// with the figure; it is kept at this height instead.
const RANGE_SLIDER_HEIGHT_PX = 63
// Measured with Plotly 3.4: the two-line x-axis labels plus the padding Plotly
// puts around the range slider.
const X_AXIS_LABELS_DEPTH_PX = 47
const NON_PLOT_HEIGHT_PX = FIGURE_MARGIN_TOP_PX + FIGURE_MARGIN_BOTTOM_PX +
    RANGE_SLIDER_HEIGHT_PX + X_AXIS_LABELS_DEPTH_PX

// Plotly sizes the slider as a fraction of the figure height between the
// margins.
const rangeSliderThickness = figureHeightPx => RANGE_SLIDER_HEIGHT_PX /
    (figureHeightPx - FIGURE_MARGIN_TOP_PX - FIGURE_MARGIN_BOTTOM_PX)

const ANNOTATION_ROW_HEIGHT_PX = 22
const ANNOTATION_TRACK_GAP_PX = 8
// The basecall and reference letters sit between the trace and the tracks.
const LETTER_ROWS_HEIGHT_PX = REFERENCE_ROW_BOTTOM_PX + 12

// The annotation tracks go under the reference row, one per annotation type
// stacked downwards, each with a fixed height per row of overlapping
// features. The figure grows by their height, so the trace keeps its size.
export const buildAxisDomains = trackRowCounts => {
    if (trackRowCounts.length === 0) {
        return {
            figureHeightPx: BASE_FIGURE_HEIGHT_PX,
            mainPlotDomain: [0, 1],
            annotationDomains: []
        }
    }

    const trackHeightsPx = trackRowCounts.map(rowCount =>
        rowCount * ANNOTATION_ROW_HEIGHT_PX)
    const totalTrackHeightPx = trackHeightsPx.reduce((sum, height) => sum + height, 0)
    const totalGapHeightPx = (trackHeightsPx.length - 1) * ANNOTATION_TRACK_GAP_PX
    const annotationSectionHeightPx =
        LETTER_ROWS_HEIGHT_PX + totalTrackHeightPx + totalGapHeightPx

    const figureHeightPx = BASE_FIGURE_HEIGHT_PX + annotationSectionHeightPx
    const plotHeightPx = figureHeightPx - NON_PLOT_HEIGHT_PX
    const toDomainFraction = heightPx => heightPx / plotHeightPx

    const mainPlotDomain = [toDomainFraction(annotationSectionHeightPx), 1]
    let trackTopPx = annotationSectionHeightPx - LETTER_ROWS_HEIGHT_PX
    const annotationDomains = trackHeightsPx.map(trackHeightPx => {
        const trackBottomPx = trackTopPx - trackHeightPx
        const domain = [toDomainFraction(trackBottomPx), toDomainFraction(trackTopPx)]
        trackTopPx = trackBottomPx - ANNOTATION_TRACK_GAP_PX
        return domain
    })

    return { figureHeightPx, mainPlotDomain, annotationDomains }
}

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
        yref: 'y domain',
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
    yref: 'y domain',
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
        // Any maxdisplayed makes Plotly draw only the markers in view, and
        // one per basecall never thins those out. Restyling every marker on
        // each pan was the largest part of the pan cost. Hover still finds
        // every basecall in view, since drawn markers keep their hover size.
        marker: { size: 16, opacity: 0, maxdisplayed: basecallPos.length },
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

    // The plot width is not known until Plotly lays it out, so the first arrow
    // heads use the figure width minus Plotly's default 80px side margins;
    // main.js redraws them at the exact size on every zoom.
    const initialAnnotationRange =
        translateMainAxisRangeToAnnotation(raw_data, ref_pos_range)
    const estimatedPlotWidthPx = Math.max(figure.clientWidth - 160, 1)
    const initialAnnotationSpan =
        initialAnnotationRange[1] - initialAnnotationRange[0]
    const initialBasesPerPixel = initialAnnotationSpan / estimatedPlotWidthPx

    const {
        traces: annotationTraces,
        yaxes: annotationYAxes,
        shapes: annotationShapes,
        labels: annotationLabels,
        trackRowCounts
    } = buildAnnotationFigureData(
        annotationData, initialAnnotationRange, initialBasesPerPixel)
    data.push(...annotationTraces)

    const { figureHeightPx, mainPlotDomain, annotationDomains } =
        buildAxisDomains(trackRowCounts)

    // Plotly puts the range slider under the lowest subplot that shares the
    // main x-axis, which would be the trace, on top of the annotation tracks.
    // An empty sliver of a subplot at the bottom of the figure moves it below
    // them.
    const sliderSpacerAxisIndex = 4 + annotationYAxes.length
    const sliderSpacerSubplots = annotationYAxes.length > 0
        ? [[`xy${sliderSpacerAxisIndex}`]]
        : []
    // A subplot exists only while a trace is on it.
    if (sliderSpacerSubplots.length > 0) {
        data.push({
            x: [],
            y: [],
            type: 'scatter',
            xaxis: 'x',
            yaxis: `y${sliderSpacerAxisIndex}`,
            hoverinfo: 'skip',
            showlegend: false
        })
    }

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
        height: figureHeightPx,
        margin: { t: FIGURE_MARGIN_TOP_PX, b: FIGURE_MARGIN_BOTTOM_PX },
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
                visible: true,
                thickness: rangeSliderThickness(figureHeightPx)
            },
            minallowed: 0,
            tickangle: 0,
            // The grid would otherwise anchor it to the bottom row, the
            // range-slider spacer.
            anchor: 'y'
        },
        xaxis2: {
            visible: false,
            matches: 'x',
            overlaying: 'x',
        },
        xaxis3: {
            visible: false,
            range: initialAnnotationRange,
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
            referenceRowEndLabel('end', initialReferenceLabels.end),
            ...annotationLabels
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
        ...(sliderSpacerSubplots.length > 0 && {
            [`yaxis${sliderSpacerAxisIndex}`]: {
                domain: [0, 0.001],
                visible: false,
                fixedrange: true
            }
        }),
        updatemenus,
        // The default 'x' mode matches on x only, so annotations stacked in
        // other rows at the same x never get a tooltip.
        hovermode: 'closest',
        grid: {
            rows: 1 + annotationYAxes.length + sliderSpacerSubplots.length,
            columns: 1,
            // Every annotation subplot must be declared or it gets no hover.
            subplots: [
                ['xy'],
                ...annotationYAxes.map(axis => [`x3y${axis._index}`]),
                ...sliderSpacerSubplots
            ],
        }
    };

    const config = { responsive: true };

    Plotly.react(figure, data, layout, config);
}

const DEFAULT_ANNOTATION_COLOR = 'rgba(0,0,255,0.5)'
const ARROW_HEAD_LENGTH_PX = 10
export const ARROW_SHAPE_NAME = 'annotation-arrow'
const ARROW_HALF_HEIGHT = 0.4

const annotationColor = annotation => {
    const colors = annotation.notes?.[annotation.forward ? 'ApEinfo_fwdcolor' : 'ApEinfo_revcolor']
    return colors?.[0] ?? DEFAULT_ANNOTATION_COLOR
}

// ApE saves how it draws the two ends of a feature as
// /ApEinfo_graphicformat="arrow_data {{<3' end>} {<5' end>} 0} width 5 offset 0".
// Each end is a list of x y points, running from the top edge of the bar out
// to the end of the feature (x away from the bar) and back to its bottom
// edge; an empty list is a flat end. width and offset place the feature on
// ApE's circular map, which the stacked tracks have no use for.
const NUMBER_PATTERN = /-?(\d+\.?\d*|\.\d+)/g
const ARROW_DATA_PATTERN = /arrow_data\s*\{\s*\{([^{}]*)\}\s*\{([^{}]*)\}/

// The GenBank parser joins a wrapped value without the space at the break,
// so "0\n -0.5" arrives as "0-0.5". Reading numbers rather than splitting on
// spaces separates those again.
const parseArrowEndPoints = list => {
    const numbers = (list.match(NUMBER_PATTERN) ?? []).map(Number)
    const unreadText = list.replace(NUMBER_PATTERN, '').trim()
    if (numbers.length % 2 !== 0 || unreadText !== '') {
        return null
    }

    const points = []
    for (let index = 0; index < numbers.length; index += 2) {
        points.push([numbers[index], numbers[index + 1]])
    }
    return points
}

// Every end ApE writes starts and ends on the bar, at x 0, with its top above
// its bottom, and stays on the outer side of it. Positive numbers the parser
// joined ("2\n 0" into "20") leave an end that does not, so it is not used.
const isUsableArrowEnd = points => {
    if (points.length === 0) {
        return true
    }
    const [firstX, firstY] = points[0]
    const [lastX, lastY] = points.at(-1)
    const staysOutsideBar = points.every(([x]) => x >= 0)
    return points.length >= 2 && firstX === 0 && lastX === 0 &&
        firstY > lastY && staysOutsideBar
}

export const parseApeArrowEnds = graphicFormat => {
    const match = ARROW_DATA_PATTERN.exec(graphicFormat)
    if (!match) {
        return null
    }

    const threePrimeEnd = parseArrowEndPoints(match[1])
    const fivePrimeEnd = parseArrowEndPoints(match[2])
    if (!threePrimeEnd || !fivePrimeEnd) {
        return null
    }
    if (!isUsableArrowEnd(threePrimeEnd) || !isUsableArrowEnd(fivePrimeEnd)) {
        return null
    }
    return { threePrimeEnd, fivePrimeEnd }
}

// ApE's default: a plain head as tall as the bar and 2 units long.
const DEFAULT_ARROW_ENDS = {
    threePrimeEnd: [[0, 1], [2, 0], [0, -1]],
    fivePrimeEnd: []
}
// The default head is ARROW_HEAD_LENGTH_PX long, which sets the size of a
// unit.
const ARROW_UNIT_PX = ARROW_HEAD_LENGTH_PX / 2

const arrowEndsOf = annotation => {
    const graphicFormat = annotation.notes?.ApEinfo_graphicformat?.[0]
    const arrowEnds = graphicFormat && parseApeArrowEnds(graphicFormat)
    return arrowEnds ?? DEFAULT_ARROW_ENDS
}

const endLengthUnits = endPoints => Math.max(0, ...endPoints.map(([x]) => x))

// Pixels the two ends take up at full size, which the label keeps clear of.
const arrowEndsLengthPx = annotation => {
    const { threePrimeEnd, fivePrimeEnd } = arrowEndsOf(annotation)
    const lengthUnits =
        endLengthUnits(threePrimeEnd) + endLengthUnits(fivePrimeEnd)
    return lengthUnits * ARROW_UNIT_PX
}

// The feature drawn in the shape ApE gives its ends, pointing right on the
// plus strand; on the minus strand the whole shape is turned round. The
// tallest point of either end fills the box, and the first and last points of
// the shaped end set the height of the bar. Ends are a fixed number of pixels
// long, so their length in bases depends on the zoom; they never take more
// than half the feature.
const arrowPath = (annotation, basesPerPixel) => {
    const { start, end } = annotation
    const featureLength = end - start
    const centerY = -annotation.yOffset
    const { threePrimeEnd, fivePrimeEnd } = arrowEndsOf(annotation)

    const allEndPoints = [...threePrimeEnd, ...fivePrimeEnd]
    const tallestPoint =
        Math.max(0, ...allEndPoints.map(([, y]) => Math.abs(y)))
    const heightScale = ARROW_HALF_HEIGHT / (tallestPoint || 1)

    const threePrimeLengthUnits = endLengthUnits(threePrimeEnd)
    const fivePrimeLengthUnits = endLengthUnits(fivePrimeEnd)
    const unitBases = ARROW_UNIT_PX * basesPerPixel
    const longestEndBases =
        unitBases * Math.max(threePrimeLengthUnits, fivePrimeLengthUnits)
    const shortening = longestEndBases > featureLength / 2
        ? (featureLength / 2) / longestEndBases
        : 1
    const lengthScale = unitBases * shortening
    const threePrimeEndBases = threePrimeLengthUnits * lengthScale
    const fivePrimeEndBases = fivePrimeLengthUnits * lengthScale

    // A flat end follows the bar, whose edges are set by the shaped end.
    const shapedEnd = threePrimeEnd.length > 0 ? threePrimeEnd : fivePrimeEnd
    const [barTop, barBottom] = shapedEnd.length > 0
        ? [shapedEnd[0][1] * heightScale, shapedEnd.at(-1)[1] * heightScale]
        : [ARROW_HALF_HEIGHT, -ARROW_HALF_HEIGHT]

    // Points along the feature, from 0 at its 5' end to featureLength at its
    // 3' end, and across it from the centre line.
    const threePrimeOutline = threePrimeEnd.length > 0
        ? threePrimeEnd.map(([x, y]) => [
            featureLength - threePrimeEndBases + x * lengthScale,
            y * heightScale
        ])
        : [[featureLength, barTop], [featureLength, barBottom]]
    const fivePrimeOutline = fivePrimeEnd.length > 0
        ? fivePrimeEnd.map(([x, y]) =>
            [fivePrimeEndBases - x * lengthScale, y * heightScale])
        : [[0, barTop], [0, barBottom]]
    // Down the 3' end, back along the bottom and up the 5' end; closing the
    // path draws the top edge.
    const outline = [...threePrimeOutline, ...fivePrimeOutline.reverse()]

    const toPlotPoint = ([along, across]) => {
        const x = annotation.forward ? start + along : end - along
        const y = annotation.forward ? centerY + across : centerY - across
        return `${x},${y}`
    }
    const [firstPoint, ...otherPoints] = outline.map(toPlotPoint)
    const lines = otherPoints.map(point => `L ${point}`).join(' ')
    return `M ${firstPoint} ${lines} Z`
}

const annotationToArrowShape = (annotation, yref, basesPerPixel) => {
    return {
        type: 'path',
        name: ARROW_SHAPE_NAME,
        path: arrowPath(annotation, basesPerPixel),
        xref: 'x3',
        yref,
        fillcolor: annotationColor(annotation),
        line: { width: 0 },
        layer: 'above'
    }
}

// A pan shifts the bases in view by a base or so, which changes the arrow
// heads by well under a pixel. Re-sending the arrow paths makes Plotly replot
// the whole figure, so they are only redrawn once the zoom has moved further.
// With 20 or fewer bases in view, one base is more than this, so panning there
// still redraws them every time.
const ARROW_REDRAW_ZOOM_TOLERANCE = 0.05

// drawnBasesPerPixel is null until the arrows are drawn at a measured width.
// A NaN from an unmeasurable span must not stop later redraws either.
export const arrowHeadsNeedRedraw = (drawnBasesPerPixel, basesPerPixel) => {
    if (!Number.isFinite(drawnBasesPerPixel)) {
        return true
    }
    const zoomChange =
        Math.abs(basesPerPixel - drawnBasesPerPixel) / drawnBasesPerPixel
    return zoomChange > ARROW_REDRAW_ZOOM_TOLERANCE
}

// Arrow paths for a new zoom level, in the same order as the arrow shapes
// buildAnnotationFigureData puts in the layout.
export const buildAnnotationArrowPaths = (annotationData, basesPerPixel) => {
    if (!annotationData) {
        return []
    }
    return annotationList(annotationData)
        .map(annotation => arrowPath(annotation, basesPerPixel))
}

// Labels use a monospace font, so their width can be worked out from the
// character count without measuring rendered text.
const LABEL_FONT_SIZE = 11
const LABEL_CHARACTER_WIDTH_PX = 7
const LABEL_PADDING_PX = 4
const ELLIPSIS = '…'
// A label cut to fewer characters than this says too little to be worth
// showing; the hover still has the full text.
const MIN_TRUNCATED_LABEL_CHARACTERS = 3
export const ANNOTATION_LABEL_NAME = 'annotation-label'

const annotationName = annotation => annotation.name ?? annotation.type ?? 'unnamed'

// Name and ID, as in the draft layout. GenBank has no ID qualifier, so those
// features show their name alone.
export const annotationLabelText = annotation => {
    const name = annotationName(annotation)
    return annotation.id ? `${name} (${annotation.id})` : name
}

export const fitLabelText = (text, widthPx) => {
    if (!(widthPx > 0)) {
        return ''
    }

    const characterCount = Math.floor(widthPx / LABEL_CHARACTER_WIDTH_PX)
    if (text.length <= characterCount) {
        return text
    }

    const keptCharacterCount = characterCount - ELLIPSIS.length
    if (keptCharacterCount < MIN_TRUNCATED_LABEL_CHARACTERS) {
        return ''
    }
    return text.slice(0, keptCharacterCount) + ELLIPSIS
}

// Most features are far longer than the bases in view, so the label is centred
// on the part of the box in view rather than on the whole box. Its width
// leaves out the shaped ends, such as the arrow head, which narrow the box.
//
// A label is hidden by leaving it without text, never with visible: false.
// Plotly fills in no defaults, such as the font, for a hidden annotation, and
// main.js later shows labels without the full redraw that would fill them in.
export const buildAnnotationLabel = (annotation, [viewStart, viewEnd], basesPerPixel) => {
    const visibleStart = Math.max(annotation.start, viewStart)
    const visibleEnd = Math.min(annotation.end, viewEnd)
    const visibleWidthPx = (visibleEnd - visibleStart) / basesPerPixel
    const textWidthPx = visibleWidthPx - arrowEndsLengthPx(annotation) -
        2 * LABEL_PADDING_PX

    return {
        x: (visibleStart + visibleEnd) / 2,
        text: fitLabelText(annotationLabelText(annotation), textWidthPx)
    }
}

const annotationList = annotationData =>
    annotationTypes.flatMap(annotationType => annotationData[annotationType] ?? [])

// Labels for a new view, in the same order as the label annotations
// buildAnnotationFigureData puts in the layout.
export const buildAnnotationLabels = (annotationData, viewRange, basesPerPixel) => {
    if (!annotationData) {
        return []
    }
    return annotationList(annotationData).map(annotation =>
        buildAnnotationLabel(annotation, viewRange, basesPerPixel))
}

const annotationToLabel = (annotation, yref, viewRange, basesPerPixel) => {
    return {
        ...buildAnnotationLabel(annotation, viewRange, basesPerPixel),
        name: ANNOTATION_LABEL_NAME,
        xref: 'x3',
        yref,
        y: -annotation.yOffset,
        showarrow: false,
        font: { family: 'monospace', size: LABEL_FONT_SIZE, color: '#000' }
    }
}

// Plotly does not wrap tooltips, and a translation runs to hundreds of
// residues.
const TOOLTIP_LINE_LENGTH = 60

// Breaks at spaces where it can; a sequence has none, so it is cut every
// TOOLTIP_LINE_LENGTH characters.
const wrapTooltipValue = value => {
    const lines = []
    let line = ''
    for (const word of value.split(' ')) {
        const candidate = line === '' ? word : `${line} ${word}`
        if (candidate.length <= TOOLTIP_LINE_LENGTH) {
            line = candidate
            continue
        }
        if (line !== '') {
            lines.push(line)
        }
        line = word
        while (line.length > TOOLTIP_LINE_LENGTH) {
            lines.push(line.slice(0, TOOLTIP_LINE_LENGTH))
            line = line.slice(TOOLTIP_LINE_LENGTH)
        }
    }
    if (line !== '') {
        lines.push(line)
    }
    return lines
}

// One line for a short value, or the key on its own line with the value
// wrapped below it.
const tooltipEntryLines = (key, value) => {
    const entry = `${key}: ${value}`
    if (entry.length <= TOOLTIP_LINE_LENGTH) {
        return [entry]
    }
    return [`${key}:`, ...wrapTooltipValue(value)]
}

// Plotly reads tooltip text as markup, so text from the file is escaped.
const escapeTooltipText = text => text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

// Fields shown in their own way rather than listed as they are: the name as
// the title, the location as GenBank coordinates and the strand in words.
// yOffset is the track row, set by the plot rather than read from the file.
const FIELDS_NOT_LISTED = new Set(
    ['name', 'start', 'end', 'forward', 'strand', 'notes', 'yOffset'])

// A field or qualifier can hold one value or several; each non-empty value
// gets its own entry.
const tooltipValueTexts = value => {
    const values = Array.isArray(value) ? value : [value]
    return values
        .filter(item => item !== null && item !== undefined)
        .map(item => typeof item === 'object' ? JSON.stringify(item) : String(item).trim())
        .filter(text => text !== '')
}

const tooltipFieldLines = (key, value) => tooltipValueTexts(value)
    .flatMap(text => tooltipEntryLines(key, text))

// ApE saves how it draws a feature (colours, arrow style) as qualifiers. They
// say nothing about the element; the colours are used for its box instead.
const isApeDisplayQualifier = qualifier => qualifier.startsWith('ApEinfo_')

// Built from whatever the parser gives for the feature: every field it sets
// and every qualifier in its notes, under their own names. Anything the file
// leaves out is left out here too.
export const annotationTooltipText = annotation => {
    // GenBank coordinates: 1-based, inclusive
    const locationLines = [
        `Coordinates: ${annotation.start + 1}..${annotation.end}`,
        `Strand: ${annotation.forward ? 'plus (+)' : 'minus (-)'}`
    ]
    const fieldLines = Object.entries(annotation)
        .filter(([key]) => !FIELDS_NOT_LISTED.has(key))
        .flatMap(([key, value]) => tooltipFieldLines(key, value))
    const qualifierLines = Object.entries(annotation.notes ?? {})
        .filter(([qualifier]) => !isApeDisplayQualifier(qualifier))
        .flatMap(([qualifier, values]) => tooltipFieldLines(qualifier, values))

    const nameLine = `<b>${escapeTooltipText(annotationName(annotation))}</b>`
    const entryLines = [...locationLines, ...fieldLines, ...qualifierLines]
    return [nameLine, ...entryLines.map(escapeTooltipText)].join('<br>')
}

const annotationsToBarTrace = (annotations) => {
    const x = []
    const y = []
    const base = []
    const color = []
    const hovertext = []

    for (const annotation of annotations) {
        x.push(annotation.end - annotation.start)
        y.push(-annotation.yOffset)
        base.push(annotation.start)
        color.push(annotationColor(annotation))
        hovertext.push(annotationTooltipText(annotation))
    }

    // The visible box is drawn as an arrow shape; the bars stay for hover and click.
    return {
        x, y, base, hovertext, type: 'bar', orientation: 'h',
        marker: { color, opacity: 0 },
        hovertemplate: '%{hovertext}<extra></extra>'
    }
}
