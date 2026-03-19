import {
    anyToJson
} from '@teselagen/bio-parsers'

export const parseAnnotationFile = async (file) =>
    await anyToJson(file, { fileName: file.name })

export const formatJsonForDisplay = (obj, indent = 2) => {
    return JSON.stringify(obj, null, indent)
}
