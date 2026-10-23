import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { makeAnnotationEndsExclusive } from '../src/parsers.js'
import {
    annotationLabelText,
    annotationsInAlignedRegion,
    arrowHeadsNeedRedraw,
    buildAnnotationLabel,
    BASE_FIGURE_HEIGHT_PX,
    buildAxisDomains,
    buildBasecallRefPositions,
    fitLabelText,
    renderAlignment,
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

describe('arrowHeadsNeedRedraw', () => {
    it('redraws arrow heads not yet drawn at a measured plot width', () => {
        // Given arrows drawn with the estimated plot width
        const drawnBasesPerPixel = null

        // When the first measured zoom level arrives
        const needsRedraw = arrowHeadsNeedRedraw(drawnBasesPerPixel, 40 / 1000)

        // Then the arrow heads are redrawn
        assert.equal(needsRedraw, true)
    })

    it('redraws arrow heads last drawn at an unmeasurable zoom', () => {
        // Given arrows drawn while the reference span could not be measured
        const drawnBasesPerPixel = NaN

        // When a measured zoom level arrives
        const needsRedraw = arrowHeadsNeedRedraw(drawnBasesPerPixel, 40 / 1000)

        // Then the arrow heads are redrawn
        assert.equal(needsRedraw, true)
    })

    it('keeps arrow heads when a pan shifts the view by one base', () => {
        // Given arrows drawn with 40 bases across 1000 pixels
        const drawnBasesPerPixel = 40 / 1000

        // When a pan brings 41 bases into view
        const needsRedraw = arrowHeadsNeedRedraw(drawnBasesPerPixel, 41 / 1000)

        // Then the arrow heads are left as they are
        assert.equal(needsRedraw, false)
    })

    it('redraws arrow heads when the zoom changes', () => {
        // Given arrows drawn with 40 bases across 1000 pixels
        const drawnBasesPerPixel = 40 / 1000

        // When a zoom out brings 80 bases into view
        const needsRedraw = arrowHeadsNeedRedraw(drawnBasesPerPixel, 80 / 1000)

        // Then the arrow heads are redrawn
        assert.equal(needsRedraw, true)
    })
})

describe('annotationLabelText', () => {
    it('shows the name and ID of a feature that has an ID', () => {
        // Given a feature with a name and an ID
        const annotation = { name: 'gene_1', id: 'gene_1_id' }

        // When its label text is built
        const text = annotationLabelText(annotation)

        // Then the ID follows the name in brackets
        assert.equal(text, 'gene_1 (gene_1_id)')
    })

    it('shows only the name of a feature without an ID', () => {
        // Given a GenBank feature, which has no ID qualifier
        const annotation = { name: 'ColE1' }

        // When its label text is built
        const text = annotationLabelText(annotation)

        // Then the label is the name alone
        assert.equal(text, 'ColE1')
    })
})

describe('fitLabelText', () => {
    it('keeps text that fits', () => {
        // Given room for 10 characters of 7px each
        const widthPx = 70

        // When a 10-character label is fitted
        const text = fitLabelText('ABCDEFGHIJ', widthPx)

        // Then it is shown in full
        assert.equal(text, 'ABCDEFGHIJ')
    })

    it('truncates text that does not fit, ending it with an ellipsis', () => {
        // Given room for 6 characters of 7px each
        const widthPx = 42

        // When a 10-character label is fitted
        const text = fitLabelText('ABCDEFGHIJ', widthPx)

        // Then 5 characters are kept and the ellipsis takes the sixth place
        assert.equal(text, 'ABCDE…')
    })

    it('hides text when too little of it would be left', () => {
        // Given room for 3 characters of 7px each
        const widthPx = 21

        // When a 10-character label is fitted
        const text = fitLabelText('ABCDEFGHIJ', widthPx)

        // Then nothing is shown
        assert.equal(text, '')
    })

    it('hides text when the width cannot be measured', () => {
        // Given a width computed from an unmeasured plot
        const widthPx = NaN

        // When a label is fitted
        const text = fitLabelText('ABC', widthPx)

        // Then nothing is shown
        assert.equal(text, '')
    })
})

describe('buildAnnotationLabel', () => {
    const basesPerPixel = 0.1

    it('centres the label on a feature that is fully in view', () => {
        // Given a feature from 100 to 200 inside a view from 50 to 250
        const annotation = { name: 'gene_1', start: 100, end: 200, yOffset: 0 }

        // When its label is built
        const label = buildAnnotationLabel(annotation, [50, 250], basesPerPixel)

        // Then it sits in the middle of the feature and shows its name
        assert.equal(label.x, 150)
        assert.equal(label.text, 'gene_1')
    })

    it('centres the label on the part of a feature that is in view', () => {
        // Given a feature from 0 to 1000 and a view from 400 to 440
        const annotation = { name: 'gene_1', start: 0, end: 1000, yOffset: 0 }

        // When its label is built
        const label = buildAnnotationLabel(annotation, [400, 440], basesPerPixel)

        // Then it sits in the middle of the view, where it can be read
        assert.equal(label.x, 420)
        assert.equal(label.text, 'gene_1')
    })

    it('hides the label of a feature that is out of view', () => {
        // Given a feature from 0 to 100 and a view from 400 to 440
        const annotation = { name: 'gene_1', start: 0, end: 100, yOffset: 0 }

        // When its label is built
        const label = buildAnnotationLabel(annotation, [400, 440], basesPerPixel)

        // Then it has no text
        assert.equal(label.text, '')
    })

    it('hides the label of a feature too narrow to hold any of it', () => {
        // Given a 2-base feature, 20px wide at this zoom
        const annotation = { name: 'gene_1', start: 100, end: 102, yOffset: 0 }

        // When its label is built
        const label = buildAnnotationLabel(annotation, [50, 250], basesPerPixel)

        // Then it has no text; the hover still shows the full name
        assert.equal(label.text, '')
    })
})

describe('buildAxisDomains', () => {
    it('keeps the base figure for a trace without annotations', () => {
        // Given no annotation tracks
        const trackRowCounts = []

        // When the axis domains are built
        const { figureHeightPx, mainPlotDomain } = buildAxisDomains(trackRowCounts)

        // Then the trace fills the base figure
        assert.equal(figureHeightPx, BASE_FIGURE_HEIGHT_PX)
        assert.deepEqual(mainPlotDomain, [0, 1])
    })

    it('stacks the tracks under the trace, first type on top', () => {
        // Given a track of 2 rows and a track of 1 row
        const trackRowCounts = [2, 1]

        // When the axis domains are built
        const { mainPlotDomain, annotationDomains } = buildAxisDomains(trackRowCounts)

        // Then the trace is above the first track, the first track is above
        // the second, and the second ends at the bottom of the plot
        const [firstTrack, secondTrack] = annotationDomains
        assert.ok(mainPlotDomain[0] > firstTrack[1])
        assert.ok(firstTrack[0] > secondTrack[1])
        assert.equal(secondTrack[0], 0)
    })

    it('gives every row of overlapping features the same height', () => {
        // Given a track of 2 rows and a track of 1 row
        const trackRowCounts = [2, 1]

        // When the axis domains are built
        const { annotationDomains } = buildAxisDomains(trackRowCounts)

        // Then the 2-row track is twice as tall as the 1-row track
        const [firstTrack, secondTrack] = annotationDomains
        const firstTrackHeight = firstTrack[1] - firstTrack[0]
        const secondTrackHeight = secondTrack[1] - secondTrack[0]
        assert.ok(Math.abs(firstTrackHeight - 2 * secondTrackHeight) < 1e-9)
    })

    it('grows the figure by the same height for every extra row', () => {
        // Given tracks of 1, 2 and 3 rows

        // When the axis domains are built for each
        const oneRow = buildAxisDomains([1])
        const twoRows = buildAxisDomains([2])
        const threeRows = buildAxisDomains([3])

        // Then each extra row adds the same height to a figure taller than
        // the base one
        assert.ok(oneRow.figureHeightPx > BASE_FIGURE_HEIGHT_PX)
        const secondRowHeightPx = twoRows.figureHeightPx - oneRow.figureHeightPx
        const thirdRowHeightPx = threeRows.figureHeightPx - twoRows.figureHeightPx
        assert.ok(secondRowHeightPx > 0)
        assert.equal(thirdRowHeightPx, secondRowHeightPx)
    })
})

describe('annotationsInAlignedRegion', () => {
    // Basecalls on reference positions 100 to 103 (0-based)
    const alignment = {
        refpos: 101,
        refalign: 'ACGT',
        gappedTrace: { leadingGaps: 0, basecallPos: [5, 9, 14, 20] }
    }

    it('keeps features that run past either end of the aligned region', () => {
        // Given a feature ending on the first aligned base and one starting
        // on the last
        const annotationData = {
            features: [
                { name: 'left', start: 0, end: 101 },
                { name: 'right', start: 103, end: 500 }
            ]
        }

        // When the features in the aligned region are picked
        const inRegion = annotationsInAlignedRegion(annotationData, alignment)

        // Then both are kept
        assert.deepEqual(inRegion.features.map(feature => feature.name), ['left', 'right'])
    })

    it('leaves out features outside the aligned region', () => {
        // Given a feature ending just before the first aligned base and one
        // starting just after the last
        const annotationData = {
            features: [
                { name: 'before', start: 0, end: 100 },
                { name: 'inside', start: 101, end: 102 },
                { name: 'after', start: 104, end: 500 }
            ]
        }

        // When the features in the aligned region are picked
        const inRegion = annotationsInAlignedRegion(annotationData, alignment)

        // Then only the one inside is kept
        assert.deepEqual(inRegion.features.map(feature => feature.name), ['inside'])
    })

    it('leaves out annotation types with nothing in the aligned region', () => {
        // Given primers that are all outside the aligned region
        const annotationData = {
            features: [{ name: 'inside', start: 101, end: 102 }],
            primers: [{ name: 'before', start: 0, end: 20 }]
        }

        // When the features in the aligned region are picked
        const inRegion = annotationsInAlignedRegion(annotationData, alignment)

        // Then there is no primer track
        assert.deepEqual(Object.keys(inRegion), ['features'])
    })

    it('has nothing to pick without an annotation file', () => {
        // Given no annotation file
        const annotationData = null

        // When the features in the aligned region are picked
        const inRegion = annotationsInAlignedRegion(annotationData, alignment)

        // Then there are no annotations
        assert.equal(inRegion, null)
    })
})

describe('annotation labels in the layout', () => {
    it('stay visible to Plotly while their feature is out of view', () => {
        // Given a feature far outside the opening view, whose label starts
        // out empty
        const alignment = {
            refchr: 'example',
            forward: 1,
            refpos: 1,
            refalign: 'ACGT',
            gappedTrace: {
                leadingGaps: 0,
                basecallPos: [2, 5, 8, 11],
                basecalls: { 2: '1:A', 5: '2:C', 8: '3:G', 11: '4:T' },
                basecallQual: [40, 40, 40, 40],
                peakA: [], peakC: [], peakG: [], peakT: []
            }
        }
        const annotationData = {
            features: [{ name: 'far', start: 3, end: 4, forward: true }]
        }
        let renderedLayout = null
        const plotly = { react: (figure, data, layout) => { renderedLayout = layout } }

        // When the alignment is rendered
        renderAlignment({ clientWidth: 1000 }, alignment, plotly, annotationData)

        // Then the label is not hidden with visible: false. Plotly fills in
        // no defaults, such as the font, for a hidden annotation, and drawing
        // it once a pan gives it text would fail.
        const label = renderedLayout.annotations
            .find(annotation => annotation.name === 'annotation-label')
        assert.notEqual(label.visible, false)
    })
})

describe('annotation track rows', () => {
    it('puts features that only touch end to start on the same row', () => {
        // Given GenBank features 1237..1242 and 1243..1248, which share no base
        const alignment = {
            refchr: 'example',
            forward: 1,
            refpos: 1237,
            refalign: 'ACGTACGTACGT',
            gappedTrace: {
                leadingGaps: 0,
                basecallPos: [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
                basecalls: Object.fromEntries([2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35]
                    .map((pos, index) => [pos, `${index + 1}:A`])),
                basecallQual: Array(12).fill(40),
                peakA: [], peakC: [], peakG: [], peakT: []
            }
        }
        const annotationData = {
            features: [
                { name: 'first', start: 1236, end: 1242, forward: true },
                { name: 'second', start: 1242, end: 1248, forward: true }
            ]
        }
        let renderedLayout = null
        const plotly = { react: (figure, data, layout) => { renderedLayout = layout } }

        // When the alignment is rendered
        renderAlignment({ clientWidth: 1000 }, alignment, plotly, annotationData)

        // Then both labels sit on the first row
        const labelRows = renderedLayout.annotations
            .filter(annotation => annotation.name === 'annotation-label')
            .map(annotation => annotation.y)
        assert.deepEqual(labelRows, [-0, -0])
    })
})
