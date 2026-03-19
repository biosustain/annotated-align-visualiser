// From https://github.com/TeselaGen/tg-oss/blob/master/packages/sequence-utils/src/prepareCircularViewData.js
// Copied cause needs fixing for undefineds

import { cloneDeep } from "lodash-es";
import { getYOffsetsForPotentiallyCircularRanges } from "@teselagen/range-utils";
import { annotationTypes } from "@teselagen/sequence-utils";

//basically just adds yOffsets to the annotations
export default function prepareCircularViewData(sequenceData) {
  const clonedSeqData = cloneDeep(sequenceData);
  annotationTypes.forEach(annotationType => {
    if (annotationType !== "cutsites") {
      const annotations = clonedSeqData[annotationType];
      if (!annotations) return;
      const maxYOffset = getYOffsetsForPotentiallyCircularRanges(
        annotations
      ).maxYOffset;
      annotations.maxYOffset = maxYOffset;
    }
  });
  return clonedSeqData;
}
