import './main.css'
import { renderAlignment } from './renderer'
import { parseAnnotationFile, formatJsonForDisplay } from './parsers'
import "https://cdn.plot.ly/plotly-3.4.0.min.js"

const plotly = window.Plotly

if (!plotly) {
    throw new Error('Plotly is not loaded. Ensure https://cdn.plot.ly/plotly-3.4.0.min.js is available.')
}

const EXAMPLE_REQUEST = {
    method: 'POST',
    headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'multipart/form-data; boundary=----WebKitFormBoundarytPLXWYbDjgWq3smR'
    },
    body: '------WebKitFormBoundarytPLXWYbDjgWq3smR\r\nContent-Disposition: form-data; name="leftTrim"\r\n\r\n50\r\n------WebKitFormBoundarytPLXWYbDjgWq3smR\r\nContent-Disposition: form-data; name="rightTrim"\r\n\r\n50\r\n------WebKitFormBoundarytPLXWYbDjgWq3smR\r\nContent-Disposition: form-data; name="showExample"\r\n\r\nshowExample\r\n------WebKitFormBoundarytPLXWYbDjgWq3smR--\r\n'
}

const state = {
    loading: false,
    currentData: null,
    annotationData: null,
    showAnnotationJson: true,
    tickSets: null,
    activeTickDensity: 'all'
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
            toSync[`yaxis${axisSuffix}.visible`] = visible
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

const sampleTickSet = (tickvals, ticktext, step) => {
    return {
        tickvals: tickvals.filter((_, index) => index % step === 0),
        ticktext: ticktext.filter((_, index) => index % step === 0)
    }
}

const buildTickSets = data => {
    const tickvals = data.gappedTrace.basecallPos
    const ticktext = tickvals.map(pos => data.gappedTrace.basecalls[pos])

    return {
        all: { tickvals, ticktext },
        every10th: sampleTickSet(tickvals, ticktext, 10),
        every100th: sampleTickSet(tickvals, ticktext, 100)
    }
}

const getRangeFromRelayout = relayoutData => {
    if (Array.isArray(relayoutData?.['xaxis.range'])) {
        return relayoutData['xaxis.range']
    }

    const rangeStart = Number(relayoutData?.['xaxis.range[0]'])
    const rangeEnd = Number(relayoutData?.['xaxis.range[1]'])
    if (Number.isFinite(rangeStart) && Number.isFinite(rangeEnd)) {
        return [rangeStart, rangeEnd]
    }

    if (relayoutData?.['xaxis.autorange']) {
        const axisRange = figure?._fullLayout?.xaxis?.range
        if (Array.isArray(axisRange) && axisRange.length === 2) {
            return axisRange
        }
    }

    return null
}

const pickTickDensity = xRange => {
    if (!Array.isArray(xRange) || xRange.length !== 2) {
        return 'all'
    }

    const span = Math.abs(Number(xRange[1]) - Number(xRange[0]))
    if (!Number.isFinite(span)) {
        return 'all'
    }

    if (span > 5000) {
        return 'every100th'
    }
    if (span > 1000) {
        return 'every10th'
    }
    return 'all'
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

const attachFigureInteractions = () => {
    if (figureInteractionsAttached || typeof figure?.on !== 'function') {
        return
    }

    figure.on('plotly_click', eventData => {
        const point = eventData?.points?.[0]
        const annotationRange = getAnnotationRangeFromClickPoint(point)
        if (!annotationRange) {
            return
        }

        const [start, end] = annotationRange
        plotly.relayout(figure, {
            'xaxis.range': [start, end]
        })
    })

    figure.on('plotly_relayout', eventData => {
        const xRange = getRangeFromRelayout(eventData)
        if (!xRange) {
            return
        }

        applyTickDensityForRange(xRange)
    })

    figure.on('plotly_restyle', () => {
        syncAuxYAxisVisibility()
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

const renderData = (data) => {
    state.currentData = data
    state.tickSets = buildTickSets(data)
    state.activeTickDensity = 'all'
    renderAlignment(figure, data, plotly, state.annotationData?.parsedSequence)
    attachFigureInteractions()
    syncAuxYAxisVisibility()
    updateCurrentInfo()
}

const loadExample = async () => {
    state.loading = true
    updateLoadingState()

    try {
        const response = await fetch('https://gear-genomics.embl.de/sage/api/v1/upload', EXAMPLE_REQUEST)
        const json = await response.json()
        renderData(json.data)
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
            renderData(data)
        } catch (error) {
            console.error('Failed to parse JSON:', error)
            alert('Invalid JSON file')
        }
    })
    reader.readAsText(file)
}

const handleAnnotationUpload = async (event) => {
    const [file] = event.target.files
    if (!file) {
        return
    }

    try {
        const results = await parseAnnotationFile(file)
        if (results.length !== 1) {
            console.error('Expected exactly one annotation entry, got:', results)
            alert('Failed to parse annotation file: expected exactly one annotation entry')
            return
        }
        const result = results[0]
        if (!result.success) {
            console.error('Parse error:', result.error)
            alert(`Failed to parse annotation file: ${result.error}`)
            return
        }

        state.annotationData = result
        state.showAnnotationJson = true
        updateAnnotationView()

        if (state.currentData) {
            renderAlignment(figure, state.currentData, plotly, state.annotationData.parsedSequence)
            attachFigureInteractions()
            syncAuxYAxisVisibility()
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
