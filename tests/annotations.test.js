import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    findReferenceMismatch,
    makeAnnotationEndsExclusive,
    refposOnReverseComplement,
    reverseComplementAnnotations
} from '../src/parsers.js'
import {
    annotationLabelText,
    annotationsInAlignedRegion,
    annotationTooltipText,
    arrowHeadsNeedRedraw,
    buildAnnotationLabel,
    BASE_FIGURE_HEIGHT_PX,
    buildAnnotationArrowPaths,
    buildAxisDomains,
    buildBasecallRefPositions,
    fitLabelText,
    parseApeArrowEnds,
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

describe('reverseComplementAnnotations', () => {
    it('mirrors the range within the sequence and swaps the strand', () => {
        // Given a 20 bp sequence with a plus strand feature at 2..7 (exclusive end)
        const parsedSequence = {
            size: 20,
            features: [{ name: 'fwd', start: 2, end: 7, forward: true, strand: 1, bases: 'AACGT' }]
        }

        // When the annotations are reverse complemented
        const reversed = reverseComplementAnnotations(parsedSequence)

        // Then the feature covers 13..18 on the minus strand
        const [feature] = reversed.features
        assert.equal(feature.start, 13)
        assert.equal(feature.end, 18)
        assert.equal(feature.forward, false)
        assert.equal(feature.strand, -1)
        assert.equal(feature.bases, 'ACGTT')
    })
})

describe('findReferenceMismatch', () => {
    const parsedSequence = { sequence: 'aaCCGTTtt' }

    it('accepts a forward alignment found at refpos, ignoring case and gaps', () => {
        // Given a forward alignment of CCG-TT starting at the 3rd base
        const alignment = { forward: 1, refpos: 3, refalign: 'CCG-TT' }

        // When it is checked against the annotation sequence
        const warning = findReferenceMismatch(alignment, parsedSequence)

        // Then there is nothing to warn about
        assert.equal(warning, null)
    })

    it('accepts a reverse alignment that is the reverse complement at refpos', () => {
        // Given a reverse alignment whose refalign reads AACGG, the reverse
        // complement of CCGTT, which starts at the 3rd base
        const alignment = { forward: 0, refpos: 3, refalign: 'AACGG' }

        // When it is checked against the annotation sequence
        const warning = findReferenceMismatch(alignment, parsedSequence)

        // Then there is nothing to warn about
        assert.equal(warning, null)
    })

    it('warns when the bases at refpos differ', () => {
        // Given an alignment of bases the annotation sequence does not have there
        const alignment = { forward: 1, refpos: 3, refalign: 'CCGAA' }

        // When it is checked against the annotation sequence
        const warning = findReferenceMismatch(alignment, parsedSequence)

        // Then a warning names the position
        assert.match(warning, /does not match.*position 3/)
    })

    it('warns when the alignment runs past the end of the annotation sequence', () => {
        // Given an alignment longer than what is left of the sequence
        const alignment = { forward: 1, refpos: 7, refalign: 'TTTAA' }

        // When it is checked against the annotation sequence
        const warning = findReferenceMismatch(alignment, parsedSequence)

        // Then it is reported as a mismatch
        assert.match(warning, /does not match/)
    })

    it('has nothing to check when the annotation file has no sequence', () => {
        // Given an annotation file without a sequence
        const alignment = { forward: 1, refpos: 3, refalign: 'CCG' }

        // When it is checked
        const warning = findReferenceMismatch(alignment, { features: [] })

        // Then no warning is raised
        assert.equal(warning, null)
    })
})

describe('refposOnReverseComplement', () => {
    it('numbers from the first column, not the last, of a reverse alignment', () => {
        // Given a 20 bp reference and a reverse alignment whose 4 reference bases
        // cover original positions 5..8 (1-based), so tracy writes refpos 5
        const alignment = { refpos: 5, refalign: 'AC-GT' }

        // When refpos is moved onto the reverse complement
        const refpos = refposOnReverseComplement(alignment, 20)

        // Then it is the 1-based position of the first column: original 8 is 13
        assert.equal(refpos, 13)
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

    it('keeps the label clear of long ends from the ApE format', () => {
        // Given a 13-base feature, 130px wide, with a 30px head and a 10px
        // block at its 5' end
        const annotation = {
            name: 'ABCDEFGHIJKLMN', start: 100, end: 113, yOffset: 0,
            notes: {
                ApEinfo_graphicformat:
                    ['arrow_data {{0 1 6 0 0 -1} {0 1 2 1 2 -1 0 -1} 0}']
            }
        }

        // When its label is built
        const label = buildAnnotationLabel(annotation, [50, 250], basesPerPixel)

        // Then it fits the 82px between the ends and their padding:
        // 11 characters of 7px, the last an ellipsis
        assert.equal(label.text, 'ABCDEFGHIJ…')
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

describe('annotationTooltipText', () => {
    it('lists the type, coordinates, strand and every qualifier of a feature', () => {
        // Given a CDS from a GenBank file, with its qualifiers as notes
        const annotation = {
            name: 'AmpR',
            type: 'CDS',
            start: 3180,
            end: 3971,
            forward: false,
            notes: {
                gene: ['bla'],
                product: ['beta-lactamase'],
                ApEinfo_fwdcolor: ['#b7e6d7']
            }
        }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then every piece of information has its own line, apart from the
        // ApE colour
        assert.deepEqual(lines, [
            '<b>AmpR</b>',
            'Coordinates: 3181..3971',
            'Strand: minus (-)',
            'type: CDS',
            'gene: bla',
            'product: beta-lactamase'
        ])
    })

    it('leaves out the display hints ApE saves with a feature', () => {
        // Given a feature with ApE's colour and arrow qualifiers
        const annotation = {
            name: 'ColE1', start: 0, end: 583, forward: false,
            notes: {
                ApEinfo_revcolor: ['#7f7f7f'],
                ApEinfo_fwdcolor: ['#7f7f7f'],
                ApEinfo_graphicformat: ['arrow_data {{0 1 2 0 0 -1} {} 0}width 5 offset 0']
            }
        }

        // When its tooltip is built
        const text = annotationTooltipText(annotation)

        // Then none of them is listed; they set the box colour instead
        assert.ok(!text.includes('ApEinfo'))
    })

    it('leaves out information the file does not give', () => {
        // Given a feature with no ID, no type and no qualifiers
        const annotation = { name: 'ColE1', start: 0, end: 583, forward: true }

        // When its tooltip is built
        const text = annotationTooltipText(annotation)

        // Then there is no placeholder for the missing ID, type or notes
        assert.equal(text, '<b>ColE1</b><br>Coordinates: 1..583<br>Strand: plus (+)')
    })

    it('shows the ID of a feature that has one', () => {
        // Given a feature with an ID
        const annotation = { name: 'gene_1', id: 'gene_1_id', start: 0, end: 10, forward: true }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then the ID is listed
        assert.ok(lines.includes('id: gene_1_id'))
    })

    it('shows the bases of a primer', () => {
        // Given a primer whose sequence the parser read from its note
        const annotation = {
            name: 'SB_PR177', type: 'primer_bind', start: 413, end: 435,
            forward: true, bases: 'tcgggtttcgccacctctgact'
        }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then the primer sequence is listed
        assert.ok(lines.includes('bases: tcgggtttcgccacctctgact'))
    })

    it('lists any other field the parser gives, under its own name', () => {
        // Given a feature from a GFF file, with a field the GenBank parser
        // never sets
        const annotation = {
            name: 'gene_1', start: 0, end: 10, forward: true,
            source: 'RefSeq', score: 0.5
        }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then the extra fields are listed as they are
        assert.ok(lines.includes('source: RefSeq'))
        assert.ok(lines.includes('score: 0.5'))
    })

    it('leaves out the row the track stacked the feature on', () => {
        // Given a feature the track has placed in its second row
        const annotation = { name: 'gene_1', start: 0, end: 10, forward: true, yOffset: 1 }

        // When its tooltip is built
        const text = annotationTooltipText(annotation)

        // Then the row, which comes from the plot and not the file, is not shown
        assert.ok(!text.includes('yOffset'))
    })

    it('lists each value of a qualifier that is given more than once', () => {
        // Given a feature with two notes
        const annotation = {
            name: 'ori', start: 0, end: 10, forward: true,
            notes: { note: ['high-copy-number', 'from pUC'] }
        }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then both notes are listed
        assert.ok(lines.includes('note: high-copy-number'))
        assert.ok(lines.includes('note: from pUC'))
    })

    it('wraps long values so the tooltip stays narrow', () => {
        // Given a CDS with a 120-residue translation
        const translation = 'M'.repeat(120)
        const annotation = {
            name: 'cds', start: 0, end: 363, forward: true,
            notes: { translation: [translation] }
        }

        // When its tooltip is built
        const lines = annotationTooltipText(annotation).split('<br>')

        // Then the translation is split over lines of at most 60 characters,
        // and none of it is lost
        const translationLines = lines.slice(lines.indexOf('translation:') + 1)
        assert.ok(translationLines.every(line => line.length <= 60))
        assert.equal(translationLines.join(''), translation)
    })

    it('shows markup characters in values as text', () => {
        // Given a note containing angle brackets and an ampersand
        const annotation = {
            name: 'tag', start: 0, end: 10, forward: true,
            notes: { note: ['<b>not bold</b> & co'] }
        }

        // When its tooltip is built
        const text = annotationTooltipText(annotation)

        // Then they are escaped rather than read as markup
        assert.ok(text.includes('note: &lt;b&gt;not bold&lt;/b&gt; &amp; co'))
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

describe('parseApeArrowEnds', () => {
    it('reads the 3\' and 5\' end shapes from ApE\'s default arrow', () => {
        // Given the graphic format ApE saves with a feature by default
        const graphicFormat =
            'arrow_data {{0 1 2 0 0 -1} {} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then the 3' end is a triangle and the 5' end is flat
        assert.deepEqual(arrowEnds, {
            threePrimeEnd: [[0, 1], [2, 0], [0, -1]],
            fivePrimeEnd: []
        })
    })

    it('reads end shapes wrapped over several lines', () => {
        // Given a barbed head and a capped tail, wrapped as in a GenBank file
        const graphicFormat = 'arrow_data {{0 0.5 0 1 2 0 0 -1 0\n -0.5} ' +
            '{0 .5 .1 .5 .1 -.5 0 -.5} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then both ends are read in full
        assert.deepEqual(arrowEnds, {
            threePrimeEnd: [[0, 0.5], [0, 1], [2, 0], [0, -1], [0, -0.5]],
            fivePrimeEnd: [[0, 0.5], [0.1, 0.5], [0.1, -0.5], [0, -0.5]]
        })
    })

    it('reads a negative number the parser joined to the one before it', () => {
        // Given a barbed head wrapped before its last number; the GenBank
        // parser joins the lines without the space between them
        const graphicFormat =
            'arrow_data {{0 0.5 0 1 2 0 0 -1 0-0.5} {} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then the joined numbers are read as two
        assert.deepEqual(arrowEnds.threePrimeEnd,
            [[0, 0.5], [0, 1], [2, 0], [0, -1], [0, -0.5]])
    })

    it('reads nothing from an end that is not joined to the bar', () => {
        // Given an end the parser corrupted by joining two wrapped positive
        // numbers twice, "2\n 0" into "20" and "0\n 1" into "01"
        const graphicFormat =
            'arrow_data {{0 1 20 0 -1 01} {} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then there is nothing to use, as its last point is off the bar
        assert.equal(arrowEnds, null)
    })

    it('reads nothing from an end with no height', () => {
        // Given an end whose only point lies on the centre line
        const graphicFormat = 'arrow_data {{2 0} {} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then there is nothing to use
        assert.equal(arrowEnds, null)
    })

    it('reads nothing from an end that reaches back over the bar', () => {
        // Given an end with a point behind the bar's end
        const graphicFormat =
            'arrow_data {{0 1 -10 0.5 2 0 0 -1} {} 0} width 5 offset 0'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then there is nothing to use
        assert.equal(arrowEnds, null)
    })

    it('reads nothing from a format it does not recognise', () => {
        // Given a graphic format that is not arrow data
        const graphicFormat = 'something else {{0 1 2}} width 5'

        // When the arrow ends are read
        const arrowEnds = parseApeArrowEnds(graphicFormat)

        // Then there is nothing to use
        assert.equal(arrowEnds, null)
    })
})

describe('arrow shapes', () => {
    // At one base per pixel ApE's default head, 2 units long, is 10 bases.
    const basesPerPixel = 1
    const pathPoints = path => [...path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)]
        .map(([, x, y]) => [Number(x), Number(y)])

    it('draws a plain arrow head when the file has no ApE format', () => {
        // Given a plus-strand feature from 0 to 100 without ApE qualifiers
        const feature = { start: 0, end: 100, forward: true, yOffset: 0 }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then a 10-base head ends in a tip at the end of the feature
        assert.deepEqual(pathPoints(path),
            [[90, 0.4], [100, 0], [90, -0.4], [0, -0.4], [0, 0.4]])
    })

    it('points the head of a minus-strand feature at its start', () => {
        // Given a minus-strand feature from 0 to 100
        const feature = { start: 0, end: 100, forward: false, yOffset: 0 }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then the tip is at the start of the feature
        assert.deepEqual(pathPoints(path),
            [[10, -0.4], [0, 0], [10, 0.4], [100, 0.4], [100, -0.4]])
    })

    it('turns an uneven head upside down on the minus strand', () => {
        // Given a minus-strand feature with a head that has a barb on top
        // only
        const feature = {
            start: 0, end: 100, forward: false, yOffset: 0,
            notes: {
                ApEinfo_graphicformat:
                    ['arrow_data {{0 1 2 0 0 -0.5} {} 0} width 5 offset 0']
            }
        }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then the arrow is turned round as a whole, so the barb is below
        assert.deepEqual(pathPoints(path),
            [[10, -0.4], [0, 0], [10, 0.2], [100, 0.2], [100, -0.4]])
    })

    it('draws a plain box for a feature ApE draws with two flat ends', () => {
        // Given a feature whose ApE format has no shape at either end
        const feature = {
            start: 0, end: 100, forward: true, yOffset: 0,
            notes: {
                ApEinfo_graphicformat:
                    ['arrow_data {{} {} 0} width 5 offset 0']
            }
        }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then it is a rectangle over the whole feature
        assert.deepEqual(pathPoints(path),
            [[100, 0.4], [100, -0.4], [0, -0.4], [0, 0.4]])
    })

    it('draws a barbed head on a narrower bar, as ApE does', () => {
        // Given a feature with ApE's barbed arrow, whose head joins the bar
        // at half the head's height
        const feature = {
            start: 0, end: 100, forward: true, yOffset: 0,
            notes: {
                ApEinfo_graphicformat:
                    ['arrow_data {{0 0.5 0 1 2 0 0 -1 0 -0.5} {} 0} width 5 offset 0']
            }
        }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then the head is full height and the bar half of it
        assert.deepEqual(pathPoints(path), [
            [90, 0.2], [90, 0.4], [100, 0], [90, -0.4], [90, -0.2],
            [0, -0.2], [0, 0.2]
        ])
    })

    it('draws the 5\' end shape at the start of a plus-strand feature', () => {
        // Given a feature with a flat 3' end and a short block on its 5' end
        const feature = {
            start: 0, end: 100, forward: true, yOffset: 0,
            notes: {
                ApEinfo_graphicformat:
                    ['arrow_data {{} {0 1 2 1 2 -1 0 -1} 0} width 5 offset 0']
            }
        }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then the block takes the first 10 bases, with the bar after it
        assert.deepEqual(pathPoints(path), [
            [100, 0.4], [100, -0.4],
            [10, -0.4], [0, -0.4], [0, 0.4], [10, 0.4]
        ])
    })

    it('keeps the head within half of a short feature', () => {
        // Given a 6-base feature, shorter than two default heads
        const feature = { start: 0, end: 6, forward: true, yOffset: 0 }

        // When its arrow is drawn
        const [path] = buildAnnotationArrowPaths(
            { features: [feature] }, basesPerPixel)

        // Then the head takes 3 bases
        assert.deepEqual(pathPoints(path),
            [[3, 0.4], [6, 0], [3, -0.4], [0, -0.4], [0, 0.4]])
    })
})
