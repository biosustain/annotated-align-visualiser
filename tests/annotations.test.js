import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { makeAnnotationEndsExclusive } from '../src/parsers.js'
import {
    buildBasecallRefPositions,
    translateAnnotationRangeToMainAxis,
    translateMainAxisRangeToAnnotation
} from '../src/renderer.js'

describe('makeAnnotationEndsExclusive', () => {
    it('turns the inclusive end from bio-parsers into an exclusive end', () => {
        // Given a GenBank feature 3..10, which bio-parsers reports as 2..9
        const parsedSequence = {
            features: [{ name: 'fwd', start: 2, end: 9, forward: true }]
        }

        // When the ends are normalized
        const normalized = makeAnnotationEndsExclusive(parsedSequence)

        // Then start is unchanged and end is one past the last base
        assert.equal(normalized.features[0].start, 2)
        assert.equal(normalized.features[0].end, 10)
    })
})

describe('buildBasecallRefPositions', () => {
    const alignment = {
        refpos: 100,
        refalign: 'AC-GT',
        gappedTrace: { leadingGaps: 1, basecallPos: [5, 9, 14, 20] }
    }

    it('does not advance the reference index on reference gaps', () => {
        // Given an alignment whose reference row has a gap in column 2

        // When reference positions are built
        const refPositions = buildBasecallRefPositions(alignment)

        // Then the base after the gap continues from the base before it
        assert.deepEqual(refPositions, [101, 102, 102, 103])
    })
})

describe('axis translation', () => {
    const alignment = {
        refpos: 100,
        refalign: 'ACGT',
        gappedTrace: { leadingGaps: 0, basecallPos: [5, 9, 14, 20] }
    }

    it('maps a trace range to reference positions', () => {
        // Given basecalls at trace positions 5, 9, 14, 20

        // When the trace range 9..20 is translated
        const range = translateMainAxisRangeToAnnotation(alignment, [9, 20])

        // Then it covers reference positions 101 and 103
        assert.deepEqual(range, [101, 103])
    })

    it('maps a reference range back to trace positions', () => {
        // Given the same alignment

        // When the reference range 101..103 is translated
        const range = translateAnnotationRangeToMainAxis(alignment, [101, 103])

        // Then it lands on the trace positions of those bases
        assert.deepEqual(range, [9, 20])
    })
})
