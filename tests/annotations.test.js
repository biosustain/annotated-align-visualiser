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
    it('reads refpos from tracy as the 1-based position of the first reference column', () => {
        // Given an alignment whose reference row starts at the first base of
        // the reference, which tracy writes as refpos 1
        const alignment = {
            refpos: 1,
            refalign: 'ACGT',
            gappedTrace: { leadingGaps: 0, basecallPos: [5, 9] }
        }

        // When reference positions are built
        const refPositions = buildBasecallRefPositions(alignment)

        // Then the first basecall sits at 0-based position 0
        assert.deepEqual(refPositions, [0, 1])
    })

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
        assert.deepEqual(refPositions, [100, 101, 101, 102])
    })
})

describe('axis translation', () => {
    const alignment = {
        refpos: 100,
        refalign: 'ACGT',
        gappedTrace: { leadingGaps: 0, basecallPos: [5, 9, 14, 20] }
    }

    it('maps a trace range to reference positions', () => {
        // Given basecalls at trace positions 5, 9, 14, 20, drawn one sample
        // earlier at x 4, 8, 13, 19

        // When the x range starts just after the base drawn at x 8
        const range = translateMainAxisRangeToAnnotation(alignment, [8.5, 19])

        // Then that base is left out: the range starts at the next base, 101,
        // and ends before the base drawn at x 19, 102
        assert.deepEqual(range, [101, 102])
    })

    it('maps a reference range back to trace positions', () => {
        // Given the same alignment

        // When the reference range 100..102 is translated
        const range = translateAnnotationRangeToMainAxis(alignment, [100, 102])

        // Then it lands on the x of those bases, where they are drawn
        assert.deepEqual(range, [8, 19])
    })
})
