# The Maker-5 ontology (seed)

The vocabulary each space's **A-Box** uses: what a workspace knows about its products (blocks,
interfaces, software modules, agent proposals), kept as RDF and synced between the site
and the tenant's edges (ADR-0007).

| File | What |
|---|---|
| `tbox/maker-5.ttl` | classes and properties: a thin layer over schema.org and friends |
| `tbox/maker-5-concepts.ttl` | SKOS concept schemes: new types are data, not code |
| `shapes/maker-5-shapes.ttl` | SHACL: what an A-Box must satisfy; the cloud refuses one that does not |
| `abox/examples/` | fictional examples; real A-Boxes hold personal data and are never committed |

Keep the shape: English is the master
label and German and French are given; ids live under `https://<domain>/id/`;
the vocabulary under `https://<domain>/ontology#`.

After a change, give the Lambdas the same files:

```bash
node backend/scripts/sync-ontology.mjs     # writes graph-shared/ontology.generated.ts
npm test --workspace packages/ontology
```
