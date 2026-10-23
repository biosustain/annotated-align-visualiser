# Example data

"Load Example" shows a Sanger read of a pUC19 plasmid carrying two U6-gRNA
cassettes, aligned to its annotated GenBank reference. The aligned region
(about bases 1375–2350, reverse read) covers overlapping features on both
strands, repeated names, 6 bp restriction sites and a `source` feature that
runs past both ends — the cases the annotation track has to lay out.

| File                      | What it is                                    |
| ------------------------- | --------------------------------------------- |
| `puc19_spec_2xu6grna.gb`  | Annotated reference, unchanged from upstream  |
| `Spec-2xU6gRNA-1.json`    | tracy alignment of `Spec-2xU6gRNA-1.ab1`      |

## Source

Both come from the `example_data/` folder of
[ponnhide/sangerseq_viewer](https://github.com/ponnhide/sangerseq_viewer) at
commit `8c2bb68940c4015bd3b8a4813b135c2a8656d5d9`, MIT licensed — see
`LICENSE-sangerseq_viewer`. Upstream also has reads `-2` and `-3` of the same
region.

## Regenerating the alignment

The JSON is the `data` object of the Sage API response, with the same trim
settings the app used for its previous example:

```bash
commit=8c2bb68940c4015bd3b8a4813b135c2a8656d5d9
raw=https://raw.githubusercontent.com/ponnhide/sangerseq_viewer/$commit
curl -sSfLO $raw/example_data/ab1/Spec-2xU6gRNA-1.ab1

# The reference FASTA is the ORIGIN block of the GenBank file.
awk '/^ORIGIN/{f=1;next} /^\/\//{f=0} f' puc19_spec_2xu6grna.gb \
  | tr -d ' 0-9\n' | (echo '>pUC19_Spec_2xU6gRNA'; fold -w 60) > ref.fa

curl -sS https://gear-genomics.embl.de/sage/api/v1/upload \
  -F leftTrim=50 -F rightTrim=50 \
  -F queryFile=@Spec-2xU6gRNA-1.ab1 -F fastaFile=@ref.fa \
  | jq -c .data > Spec-2xU6gRNA-1.json
```

Locally, `tracy align --trimLeft 50 --trimRight 50 -r ref.fa -o out
Spec-2xU6gRNA-1.ab1` writes the same JSON to `out.json`.
