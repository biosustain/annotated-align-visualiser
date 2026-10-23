import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { renderAlignment } from '../src/renderer.js'

describe('basecall hover markers', () => {
    it('caps the drawn markers at one per basecall', () => {
        // Given an alignment with three basecalls
        const alignment = {
            refchr: 'example',
            forward: 1,
            refpos: 0,
            refalign: 'ACG',
            gappedTrace: {
                leadingGaps: 0,
                basecallPos: [2, 5, 8],
                basecalls: { 2: '1:A', 5: '2:C', 8: '3:G' },
                basecallQual: [40, 40, 40],
                peakA: [0, 1, 0, 0, 0, 0, 0, 0, 0],
                peakC: [0, 0, 0, 0, 1, 0, 0, 0, 0],
                peakG: [0, 0, 0, 0, 0, 0, 0, 1, 0],
                peakT: [0, 0, 0, 0, 0, 0, 0, 0, 0]
            }
        }
        let renderedTraces = null
        const plotly = { react: (figure, data) => { renderedTraces = data } }

        // When the alignment is rendered
        renderAlignment({ clientWidth: 1000 }, alignment, plotly)

        // Then the hover markers draw at most every basecall, which makes
        // Plotly skip the ones outside the view
        const hoverTrace =
            renderedTraces.find(trace => trace.name === 'Basecall')
        assert.equal(hoverTrace.x.length, 3)
        assert.equal(hoverTrace.marker.maxdisplayed, 3)
    })
})
