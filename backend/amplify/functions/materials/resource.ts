import { defineFunction } from "@aws-amplify/backend";

// A workspace's stock (ADR-0008 to ADR-0010 in maker-5-shared): the
// catalogue, units, what each product took, codes. The only writer of the
// Mk* tables, with edgeMaterials for edges. Tables, IAM and env in backend.ts.
export const materials = defineFunction({
  name: "materials",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "data",
});
