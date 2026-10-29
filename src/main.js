import './main.css'
import {
    renderAlignment,
    buildBasecallTickText,
    referenceRangeLabels,
    REFERENCE_ROW_BOTTOM_PX,
    REFERENCE_ROW_START_LABEL_INDEX,
    REFERENCE_ROW_END_LABEL_INDEX,
    ARROW_SHAPE_NAME,
    ANNOTATION_LABEL_NAME,
    arrowHeadsNeedRedraw,
    buildAnnotationArrowPaths,
    buildAnnotationLabels,
    annotationsInAlignedRegion,
    translateAnnotationRangeToMainAxis,
    translateMainAxisRangeToAnnotation
} from './renderer'
import {
    parseAnnotationFile,
    findReferenceMismatch,
    formatJsonForDisplay,
    refposOnReverseComplement,
    reverseComplementAnnotations
} from './parsers'
import "https://cdn.plot.ly/plotly-3.4.0.min.js"

const plotly = window.Plotly

if (!plotly) {
    throw new Error('Plotly is not loaded. Ensure https://cdn.plot.ly/plotly-3.4.0.min.js is available.')
}

// A trace and the annotated reference it was aligned to, served from
// public/examples/. See the README there for where they come from.
const EXAMPLE_BASE_URL = `${import.meta.env.BASE_URL}examples/`
const EXAMPLE_TRACE_FILE_NAME = 'Spec-2xU6gRNA-1.json'
const EXAMPLE_ANNOTATION_FILE_NAME = 'puc19_spec_2xu6grna.gb'

const state = {
    loading: false,
    currentData: null,
    // currentData with refpos moved onto the strand the annotations are drawn
    // on, which differs from it for a reverse alignment.
    alignedData: null,
    annotationData: null,
    // The example's annotations describe the example reference only, so they
    // are dropped when a trace of another reference is uploaded.
    annotationsFromExample: false,
    // The annotations drawn on the tracks: those in the aligned region of the
    // current trace.
    trackAnnotations: null,
    showAnnotationJson: true,
    tickSets: null,
    activeTickDensity: 'all',
    // Zoom level the arrow heads were last drawn at.
    arrowBasesPerPixel: null
}

const elements = {
    plot: document.getElementById('plot'),
    fileInput: document.getElementById('file-input'),
    annotationInput: document.getElementById('annotation-input'),
    loadExampleButton: document.getElementById('load-example-button'),
    annotationContainer: document.getElementById('annotation-container'),
    annotationHeader: document.getElementById('annotation-header'),
    annotationTitle: document.getElementById('annotation-title'),
    annotationToggle: document.getElementById('annotation-toggle'),
    annotationJson: document.getElementById('annotation-json'),
    annotationWarning: document.getElementById('annotation-warning'),
    annotationFileName: document.getElementById('annotation-file-name'),
    annotationJsonContent: document.getElementById('annotation-json-content'),
    currentInfo: document.getElementById('current-info'),
    placeholderInfo: document.getElementById('placeholder-info')
}

const figure = elements.plot
let figureInteractionsAttached = false
let isApplyingTickDensity = false
let isSyncingAxisVisibility = false

const isTraceVisible = trace => trace?.visible === undefined || trace?.visible === true

const syncAuxYAxisVisibility = () => {
    if (isSyncingAxisVisibility || !Array.isArray(figure?.data)) {
        return
    }

    const toSync = {}

    for (let i = 0; i < 5; i++) {
        const axisSuffix = i === 0 ? '' : i
        const visible = figure.data.some(trace => trace?.yaxis === `y${axisSuffix}` && isTraceVisible(trace))
        const currentlyVisible = figure?.layout?.[`yaxis${axisSuffix}`]?.visible !== false
        if (visible !== currentlyVisible) {
            toSync[`yaxis${axisSuffix}.visible`] = false //visible
        }
    }

    if (Object.keys(toSync).length === 0) {
        return
    }

    isSyncingAxisVisibility = true
    Promise.resolve(plotly.relayout(figure, toSync)).finally(() => {
        isSyncingAxisVisibility = false
    })
}

const buildTickSets = data => {
    const basecallPos = data.gappedTrace.basecallPos
    // Same `pos - 1` x as the traces in renderer.js.
    const tickvals = basecallPos.map(pos => pos - 1)
    const ticktext = buildBasecallTickText(data)

    // Blank labels instead of hiding them, so the axis keeps its position.
    // Only every 10th tick is kept: each tick costs layout work on every pan.
    const thinnedTickvals = tickvals.filter((_, index) => index % 10 === 0)
    const blankTicktext = thinnedTickvals.map(() => ' <br> ')

    return {
        all: { tickvals, ticktext },
        none: { tickvals: thinnedTickvals, ticktext: blankTicktext }
    }
}

const getRangeFromRelayout = (axis, relayoutData) => {
    if (Array.isArray(relayoutData?.[`${axis}.range`])) {
        return relayoutData[`${axis}.range`]
    }

    const rangeStart = Number(relayoutData?.[`${axis}.range[0]`])
    const rangeEnd = Number(relayoutData?.[`${axis}.range[1]`])
    if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)) {
        return [rangeStart, rangeEnd]
    }

    if (relayoutData?.[`${axis}.autorange`]) {
        const axisRange = figure?._fullLayout?.[axis]?.range
        if (Array.isArray(axisRange) && axisRange.length === 2) {
            return axisRange
        }
    }

    return null
}

// One letter plus a small gap. Most labels are a single base; a double call
// like "T|A" may touch its neighbours, which is accepted while the single
// letters stay readable.
const MIN_PIXELS_BETWEEN_TICK_LABELS = 10

// Labels are shown only while neighbouring ticks are far enough apart.
const pickTickDensity = xRange => {
    const tickvals = state.tickSets?.all.tickvals
    const plotWidthPx = figure?._fullLayout?.xaxis?._length
    const hasRange = Array.isArray(xRange) && xRange.length === 2
    if (!hasRange || !tickvals?.length || !plotWidthPx) {
        return 'all'
    }

    const span = Math.abs(Number(xRange[1]) - Number(xRange[0]))
    const tickvalsSpan = tickvals.at(-1) - tickvals[0]
    const averageTickSpacing = tickvalsSpan / Math.max(tickvals.length - 1, 1)
    if (!Number.isFinite(span) || !(averageTickSpacing > 0)) {
        return 'all'
    }

    const pixelsBetweenTicks = (averageTickSpacing / span) * plotWidthPx
    return pixelsBetweenTicks >= MIN_PIXELS_BETWEEN_TICK_LABELS ? 'all' : 'none'
}

const applyTickDensityForRange = xRange => {
    if (!state.tickSets || isApplyingTickDensity) {
        return
    }

    const density = pickTickDensity(xRange)
    if (density === state.activeTickDensity) {
        return
    }

    const tickSet = state.tickSets[density]
    if (!tickSet) {
        return
    }

    isApplyingTickDensity = true
    Promise.resolve(plotly.relayout(figure, {
        'xaxis.tickvals': tickSet.tickvals,
        'xaxis.ticktext': tickSet.ticktext
    })).finally(() => {
        state.activeTickDensity = density
        isApplyingTickDensity = false
    })
}

// Each label is anchored to the edge facing away from the plot.
const REFERENCE_ROW_LABEL_ANCHORS = {
    [REFERENCE_ROW_START_LABEL_INDEX]: 'end',
    [REFERENCE_ROW_END_LABEL_INDEX]: 'start'
}

// Writes the text straight into the drawn annotation, because a relayout
// redraws the whole figure and doubled the cost of every pan. Both layouts are
// updated too: axis-range relayouts redraw annotations from _fullLayout, full
// redraws rebuild it from layout.
const setReferenceRowLabel = (annotationIndex, text) => {
    figure.layout.annotations[annotationIndex].text = text
    figure._fullLayout.annotations[annotationIndex].text = text

    const textElement = figure.querySelector(
        `.annotation[data-index="${annotationIndex}"] .annotation-text`)
    if (!textElement) {
        return
    }

    // Plotly centres the text in a box sized for the old text. Anchoring it to
    // the edge facing away from the plot keeps a longer number from growing
    // into the plot.
    const anchor = REFERENCE_ROW_LABEL_ANCHORS[annotationIndex]
    const backgroundBox = textElement.previousElementSibling
    const boxWidth = Number(backgroundBox?.getAttribute('width') ?? 0)
    textElement.setAttribute('text-anchor', anchor)
    textElement.setAttribute('x', anchor === 'end' ? boxWidth : 0)
    textElement.textContent = text
}

const updateReferenceRowLabels = xRange => {
    const { start, end } = referenceRangeLabels(state.alignedData, xRange)
    setReferenceRowLabel(REFERENCE_ROW_START_LABEL_INDEX, `${start}`)
    setReferenceRowLabel(REFERENCE_ROW_END_LABEL_INDEX, `${end}`)
}

const annotationBasesPerPixel = annotationRange => {
    const plotWidthPx = figure._fullLayout?.xaxis3?._length
    if (!plotWidthPx) {
        return null
    }

    const annotationSpan = Math.abs(annotationRange[1] - annotationRange[0])
    return annotationSpan / plotWidthPx
}

// Arrow heads keep a fixed pixel size, so their paths are rebuilt for the new
// annotation range once the zoom has changed enough to matter. Folded into the
// axis-sync relayout that runs anyway, which is why the new zoom level is
// recorded here.
const arrowShapeUpdates = annotationRange => {
    const basesPerPixel = annotationBasesPerPixel(annotationRange)
    if (basesPerPixel === null) {
        return {}
    }

    if (!arrowHeadsNeedRedraw(state.arrowBasesPerPixel, basesPerPixel)) {
        return {}
    }
    state.arrowBasesPerPixel = basesPerPixel

    const arrowPaths = buildAnnotationArrowPaths(
        state.trackAnnotations, basesPerPixel)
    const arrowShapeIndexes = figure.layout.shapes.flatMap((shape, index) =>
        shape.name === ARROW_SHAPE_NAME ? [index] : [])

    return Object.fromEntries(arrowShapeIndexes.map((shapeIndex, arrowIndex) =>
        [`shapes[${shapeIndex}].path`, arrowPaths[arrowIndex]]))
}

// Arrows and labels are layout shapes and annotations, which the legend does
// not control. Each annotation type has its own y-axis, so they follow the
// legend entry that shares it.
const hiddenAnnotationAxes = () => new Set(figure.data
    .filter(trace => trace.xaxis === 'x3' && !isTraceVisible(trace))
    .map(trace => trace.yaxis))

// Position and text of every label for the annotation range, keyed
// by the label's index among the layout annotations.
const annotationLabelUpdates = annotationRange => {
    const basesPerPixel = annotationBasesPerPixel(annotationRange)
    if (basesPerPixel === null) {
        return []
    }

    const labels = buildAnnotationLabels(
        state.trackAnnotations, annotationRange, basesPerPixel)
    const hiddenAxes = hiddenAnnotationAxes()
    const labelAnnotationIndexes = figure.layout.annotations.flatMap(
        (annotation, index) => annotation.name === ANNOTATION_LABEL_NAME ? [index] : [])

    // A label is hidden by emptying its text; see buildAnnotationLabel.
    return labelAnnotationIndexes.map((annotationIndex, labelIndex) => {
        const label = labels[labelIndex]
        const yref = figure.layout.annotations[annotationIndex].yref
        return {
            annotationIndex,
            update: {
                x: label.x,
                text: hiddenAxes.has(yref) ? '' : label.text
            }
        }
    })
}

// Labels move with every pan, to stay on the part of each feature in view.
// Sending them as relayout updates makes Plotly replot the whole figure, so
// they are written into both layouts instead, just before a relayout that
// redraws the annotations anyway: an axis-range relayout draws them from
// _fullLayout, a full redraw rebuilds that from layout.
const writeAnnotationLabels = annotationRange => {
    for (const { annotationIndex, update } of annotationLabelUpdates(annotationRange)) {
        Object.assign(figure.layout.annotations[annotationIndex], update)
        Object.assign(figure._fullLayout.annotations[annotationIndex], update)
    }
}

// The same labels as relayout updates, for the rare changes that replot the
// figure anyway.
const annotationLabelRelayoutUpdates = annotationRange => {
    const updates = {}
    for (const { annotationIndex, update } of annotationLabelUpdates(annotationRange)) {
        for (const [key, value] of Object.entries(update)) {
            updates[`annotations[${annotationIndex}].${key}`] = value
        }
    }
    return updates
}

const syncArrowVisibility = () => {
    const shapes = figure.layout?.shapes ?? []
    const hiddenAxes = hiddenAnnotationAxes()

    const updates = {}
    shapes.forEach((shape, index) => {
        if (shape.name !== ARROW_SHAPE_NAME) {
            return
        }
        const shouldBeVisible = !hiddenAxes.has(shape.yref)
        if ((shape.visible !== false) !== shouldBeVisible) {
            updates[`shapes[${index}].visible`] = shouldBeVisible
        }
    })

    if (Object.keys(updates).length > 0) {
        const annotationRange = figure._fullLayout.xaxis3.range
        plotly.relayout(figure, {
            ...updates,
            ...annotationLabelRelayoutUpdates(annotationRange)
        })
    }
}

const refreshForPlotWidth = () => {
    const xRange = figure._fullLayout?.xaxis?.range
    if (!xRange) {
        return
    }
    applyTickDensityForRange(xRange)
    updateReferenceRowLabels(xRange)

    // Labels are re-fitted to the new width on every resize; a resize is rare
    // enough that the redraw this takes does not matter.
    const annotationRange = figure._fullLayout?.xaxis3?.range
    if (hasAnnotationAxis() && annotationRange) {
        return plotly.relayout(figure, {
            ...arrowShapeUpdates(annotationRange),
            ...annotationLabelRelayoutUpdates(annotationRange)
        })
    }
}

const hasAnnotationAxis = () => figure.data.some(trace => trace.xaxis === 'x3')

const getAnnotationRangeFromClickPoint = (point) => {
    const yaxisName = point?.data?.yaxis
    if (typeof yaxisName !== 'string' || !yaxisName.startsWith('y')) {
        return null
    }

    const yaxisIndex = Number.parseInt(yaxisName.slice(1), 10)
    if (!Number.isFinite(yaxisIndex) || yaxisIndex <= 3) {
        return null
    }

    const pointIndex = point?.pointNumber
    const traceX = point?.data?.x
    const traceBase = point?.data?.base
    if (!Number.isInteger(pointIndex) || !Array.isArray(traceX) || !Array.isArray(traceBase)) {
        return null
    }

    const width = Number(traceX[pointIndex])
    const start = Number(traceBase[pointIndex])
    if (!Number.isFinite(width) || !Number.isFinite(start)) {
        return null
    }

    const end = start + width
    return [Math.min(start, end), Math.max(start, end)]
}

const nearestIndex = (values, target) => {
    let bestIndex = 0
    for (let index = 1; index < values.length; index++) {
        const distance = Math.abs(values[index] - target)
        if (distance < Math.abs(values[bestIndex] - target)) {
            bestIndex = index
        }
    }
    return bestIndex
}

// Plotly only detects hover inside the plot area, and the basecall and
// reference letters sit below it. Over that strip, the Basecall trace's
// tooltip is shown for the nearest base.
let hoveredLetterPoint = null

const clearLetterStripTooltip = () => {
    if (hoveredLetterPoint !== null) {
        plotly.Fx.unhover(figure)
        hoveredLetterPoint = null
    }
}

const showBasecallTooltipOverLetters = event => {
    const xaxis = figure._fullLayout?.xaxis
    const yaxis = figure._fullLayout?.yaxis
    const basecallTraceIndex = figure.data
        ?.findIndex(trace => trace.name === 'Basecall') ?? -1
    if (!xaxis || !yaxis || basecallTraceIndex === -1) {
        return
    }

    const figureBox = figure.getBoundingClientRect()
    const xInPlot = event.clientX - figureBox.left - xaxis._offset
    const axisBottom = yaxis._offset + yaxis._length
    const yBelowAxis = event.clientY - figureBox.top - axisBottom
    const isOverLetterStrip = xInPlot >= 0 && xInPlot <= xaxis._length &&
        yBelowAxis > 0 && yBelowAxis <= REFERENCE_ROW_BOTTOM_PX

    if (!isOverLetterStrip) {
        clearLetterStripTooltip()
        return
    }

    const basecallXs = figure.data[basecallTraceIndex].x
    const pointNumber = nearestIndex(basecallXs, xaxis.p2d(xInPlot))
    // Redrawing the same tooltip on every pixel of movement is wasted work.
    if (pointNumber === hoveredLetterPoint) {
        return
    }
    const point = { curveNumber: basecallTraceIndex, pointNumber }
    plotly.Fx.hover(figure, [point], 'x2y3')
    hoveredLetterPoint = pointNumber
}

const attachFigureInteractions = () => {
    if (figureInteractionsAttached || typeof figure?.on !== 'function') {
        return
    }

    figure.addEventListener('mousemove', showBasecallTooltipOverLetters)
    figure.addEventListener('mouseleave', clearLetterStripTooltip)

    figure.on('plotly_click', eventData => {
        const point = eventData?.points?.[0]
        const annotationRange = getAnnotationRangeFromClickPoint(point)
        if (!annotationRange) {
            return
        }

        // The feature is in reference positions; the main x-axis is in trace
        // samples.
        const mainAxisRange =
            translateAnnotationRangeToMainAxis(state.alignedData, annotationRange)
        plotly.relayout(figure, {
            'xaxis.range': mainAxisRange
        })
    })

    let disableNextAxisSync = false
    figure.on('plotly_relayout', eventData => {
        // A window resize keeps the ranges but changes the pixel width, which
        // tick density, the end labels and the arrow-head size depend on.
        if (eventData?.autosize) {
            return refreshForPlotWidth()
        }

        const xRange = getRangeFromRelayout('xaxis', eventData)
        if (xRange) {
            applyTickDensityForRange(xRange)
            updateReferenceRowLabels(xRange)
            if (disableNextAxisSync) {
                disableNextAxisSync = false
                return
            }
            // Without an annotation file there is no annotation axis to sync.
            if (!hasAnnotationAxis()) {
                return
            }
            disableNextAxisSync = true
            // Scale annotation x-axis to match the new x-axis range
            const annotationRange =
                translateMainAxisRangeToAnnotation(state.alignedData, xRange)
            writeAnnotationLabels(annotationRange)
            return plotly.relayout(figure, {
                'xaxis3.range': annotationRange,
                ...arrowShapeUpdates(annotationRange)
            })
        }
        const x3Range = getRangeFromRelayout('xaxis3', eventData)
        if (x3Range) {
            if (disableNextAxisSync) {
                disableNextAxisSync = false
                return
            }
            disableNextAxisSync = true
            // Scale x-axis to fit the annotation x-axis range
            return plotly.relayout(figure, {
                'xaxis.range':
                    translateAnnotationRangeToMainAxis(state.alignedData, x3Range)
            })
        }
    })

    figure.on('plotly_restyle', () => {
        syncAuxYAxisVisibility()
        syncArrowVisibility()
    })

    figureInteractionsAttached = true
}

const updateCurrentInfo = () => {
    if (state.currentData) {
        elements.currentInfo.textContent = `Current: ${state.currentData.refchr || 'Unnamed'} (${state.currentData.forward ? 'forward' : 'reverse'} strand)`
        elements.currentInfo.classList.remove('hidden')
        elements.placeholderInfo.classList.add('hidden')
        return
    }

    elements.currentInfo.classList.add('hidden')
    elements.placeholderInfo.classList.remove('hidden')
}

const updateLoadingState = () => {
    elements.loadExampleButton.disabled = state.loading
    elements.loadExampleButton.textContent = state.loading ? 'Loading...' : 'Load Example'
}

const updateAnnotationView = () => {
    if (!state.annotationData) {
        elements.annotationContainer.classList.add('hidden')
        return
    }

    elements.annotationContainer.classList.remove('hidden')
    elements.annotationTitle.textContent = 'Annotations'
    elements.annotationToggle.textContent = state.showAnnotationJson ? '▼' : '▶'
    elements.annotationJson.classList.toggle('hidden', !state.showAnnotationJson)
    elements.annotationFileName.textContent = state.annotationData.fileName ? `File: ${state.annotationData.fileName}` : ''
    elements.annotationJsonContent.textContent = formatJsonForDisplay(state.annotationData.parsedSequence, 2)
}

const updateReferenceMismatchWarning = data => {
    const warning = findReferenceMismatch(data, state.annotationData?.parsedSequence)
    elements.annotationWarning.textContent = warning ?? ''
    elements.annotationWarning.classList.toggle('hidden', !warning)
}

// A reverse alignment is against the reverse complement of the reference, so
// the annotations and refpos are moved onto that strand to line up with it.
const orientToAlignedStrand = (parsedSequence, data) => {
    if (!parsedSequence || data.forward) {
        return { annotations: parsedSequence, alignment: data }
    }

    const annotations = reverseComplementAnnotations(parsedSequence)
    const refpos = refposOnReverseComplement(data, parsedSequence.size)
    return { annotations, alignment: { ...data, refpos } }
}

const renderData = (data) => {
    state.currentData = data
    state.tickSets = buildTickSets(data)
    state.activeTickDensity = 'all'
    // The new figure's arrows are drawn with an estimated plot width.
    state.arrowBasesPerPixel = null
    const { annotations, alignment } = orientToAlignedStrand(
        state.annotationData?.parsedSequence, data)
    state.trackAnnotations = annotationsInAlignedRegion(annotations, alignment)
    state.alignedData = alignment
    updateReferenceMismatchWarning(data)
    renderAlignment(figure, alignment, plotly, state.trackAnnotations)
    attachFigureInteractions()
    syncAuxYAxisVisibility()
    updateCurrentInfo()
}

const fetchExampleFile = async (fileName) => {
    const response = await fetch(`${EXAMPLE_BASE_URL}${fileName}`)
    if (!response.ok) {
        throw new Error(`${fileName}: ${response.status} ${response.statusText}`)
    }
    return response
}

const loadExample = async () => {
    state.loading = true
    updateLoadingState()

    try {
        const traceResponse = await fetchExampleFile(EXAMPLE_TRACE_FILE_NAME)
        const traceData = await traceResponse.json()

        // The annotation parser reads File objects, as from the upload input.
        const annotationResponse = await fetchExampleFile(EXAMPLE_ANNOTATION_FILE_NAME)
        const annotationText = await annotationResponse.text()
        const annotationFile = new File([annotationText], EXAMPLE_ANNOTATION_FILE_NAME)

        // Without its annotations the example trace is still worth showing,
        // but not with annotations left over from another reference.
        clearAnnotations()
        const annotationsApplied = await applyAnnotationFile(annotationFile)
        state.annotationsFromExample = annotationsApplied
        renderData(traceData)
    } catch (error) {
        console.error('Failed to load example:', error)
        alert('Failed to load example data')
    } finally {
        state.loading = false
        updateLoadingState()
    }
}

const handleTraceUpload = (event) => {
    const [file] = event.target.files
    if (!file) {
        return
    }

    const reader = new FileReader()
    reader.addEventListener('load', () => {
        try {
            const data = JSON.parse(reader.result)
            if (state.annotationsFromExample) {
                clearAnnotations()
            }
            renderData(data)
        } catch (error) {
            console.error('Failed to parse JSON:', error)
            alert('Invalid JSON file')
        }
    })
    reader.readAsText(file)
}

// Returns whether the annotations were applied; parse problems are alerted.
const applyAnnotationFile = async (file) => {
    const results = await parseAnnotationFile(file)
    if (results.length !== 1) {
        console.error('Expected exactly one annotation entry, got:', results)
        alert('Failed to parse annotation file: expected exactly one annotation entry')
        return false
    }
    const result = results[0]
    if (!result.success) {
        console.error('Parse error:', result.error)
        alert(`Failed to parse annotation file: ${result.error}`)
        return false
    }

    state.annotationData = result
    state.annotationsFromExample = false
    state.showAnnotationJson = true
    updateAnnotationView()
    return true
}

const clearAnnotations = () => {
    state.annotationData = null
    state.annotationsFromExample = false
    updateAnnotationView()
}

const handleAnnotationUpload = async (event) => {
    const [file] = event.target.files
    if (!file) {
        return
    }

    try {
        const annotationsApplied = await applyAnnotationFile(file)
        if (!annotationsApplied) {
            return
        }

        // renderData also resets the tick density the new figure starts with.
        if (state.currentData) {
            renderData(state.currentData)
        }
    } catch (error) {
        console.error('Upload error:', error)
        alert('Error uploading annotation file')
    }
}

const toggleAnnotationView = () => {
    state.showAnnotationJson = !state.showAnnotationJson
    updateAnnotationView()
}

elements.fileInput.addEventListener('change', handleTraceUpload)
elements.annotationInput.addEventListener('change', handleAnnotationUpload)
elements.loadExampleButton.addEventListener('click', loadExample)
elements.annotationHeader.addEventListener('click', toggleAnnotationView)

updateCurrentInfo()
updateLoadingState()
updateAnnotationView()
loadExample()
