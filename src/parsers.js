import {
    anyToJson
} from '@teselagen/bio-parsers'
import { annotationTypes } from '@teselagen/sequence-utils'

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
