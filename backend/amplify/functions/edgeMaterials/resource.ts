import { defineFunction } from "@aws-amplify/backend";

// POST /edge/v1/materials/{list,get,unit,resolve,product,reserve,release,return}
// (Bearer device_token): an edge reads its workspace's stock and takes parts
// for a product, as the workspace's edge. ADR-0010 in maker-5-shared.
export const edgeMaterials = defineFunction({
  name: "edgeMaterials",
  entry: "./handler.ts",
  timeoutSeconds: 30,
  resourceGroupName: "edge",
});
