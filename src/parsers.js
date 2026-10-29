import {
    anyToJson
} from '@teselagen/bio-parsers'
import {
    annotationTypes,
    getReverseComplementAnnotation,
    getReverseComplementSequenceString
} from '@teselagen/sequence-utils'

// bio-parsers reports a 0-based start and an inclusive 0-based end. The plot
// and the hover text both need a half-open range, so end is made exclusive
// here, once. GenBank coordinates are then `start + 1` and `end`.
export const makeAnnotationEndsExclusive = (parsedSequence) => {
    const normalized = { ...parsedSequence }

    for (const annotationType of annotationTypes) {
        const annotations = parsedSequence[annotationType]
        if (!Array.isArray(annotations)) continue

        normalized[annotationType] = annotations.map(annotation => ({
            ...annotation,
            end: annotation.end + 1
        }))
    }

    return normalized
}

// tracy aligns a reverse alignment against the reverse complement of the
// reference, but the annotation file describes the original (+) strand. This
// moves every annotation onto the reverse complement: its range is mirrored
// within the sequence and it swaps strand. Ends must already be exclusive.
export const reverseComplementAnnotations = (parsedSequence) => {
    const sequenceLength = parsedSequence.size
    const reversed = { ...parsedSequence }

    for (const annotationType of annotationTypes) {
        const annotations = parsedSequence[annotationType]
        if (!Array.isArray(annotations)) continue

        reversed[annotationType] = annotations.map(annotation => {
            // sequence-utils works with inclusive ends, like bio-parsers.
            const inclusiveEnd = { ...annotation, end: annotation.end - 1 }
            const mirrored = getReverseComplementAnnotation(
                inclusiveEnd, sequenceLength)
            mirrored.end += 1
            if (typeof annotation.bases === 'string') {
                mirrored.bases = getReverseComplementSequenceString(annotation.bases)
            }
            return mirrored
        })
    }

    return reversed
}

// For a reverse alignment, tracy's refpos is the 1-based position on the
// original strand of the LAST base in refalign. On the reverse complement the
// same base sits at sequenceLength - refpos + 1 - (bases in refalign) + 1, so
// the first column is the one numbering starts from.
export const refposOnReverseComplement = ({ refpos, refalign }, sequenceLength) => {
    const referenceBaseCount = [...refalign].filter(base => base !== '-').length
    const lastBaseOnReverseComplement = sequenceLength - refpos + 1
    return lastBaseOnReverseComplement - referenceBaseCount + 1
}

// The reference an alignment was made against is not recorded in the
// alignment, only the bases it covers. When the annotation file carries a
// sequence, those bases must be found in it at refpos, or the annotations
// describe some other reference. Returns null when the sequence matches or
// there is none to check against, otherwise a warning for the user.
export const findReferenceMismatch = (alignment, parsedSequence) => {
    const annotationSequence = parsedSequence?.sequence
    if (!annotationSequence) return null

    const alignedBases = alignment.refalign.replaceAll('-', '').toUpperCase()
    const firstIndex = alignment.refpos - 1
    const coveredBases = annotationSequence
        .slice(firstIndex, firstIndex + alignedBases.length)
        .toUpperCase()
    // tracy reports refpos on the original strand for a reverse alignment too,
    // while its refalign is the reverse complement of the bases there.
    const expectedBases = alignment.forward
        ? coveredBases
        : getReverseComplementSequenceString(coveredBases)

    if (expectedBases === alignedBases) return null

    return 'The reference sequence in the annotation file does not match the ' +
        `aligned reference at position ${alignment.refpos}. The annotations ` +
        'may describe a different sequence and be misplaced.'
}

export const parseAnnotationFile = async (file) => {
    const results = await anyToJson(file, { fileName: file.name })

    return results.map(result => {
        if (!result.success) return result
        return {
            ...result,
            parsedSequence: makeAnnotationEndsExclusive(result.parsedSequence)
        }
    })
}

export const formatJsonForDisplay = (obj, indent = 2) => {
    return JSON.stringify(obj, null, indent)
}
