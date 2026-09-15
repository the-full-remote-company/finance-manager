// Public entry point for @finance/core.
//
// Article VI: this package receives plain data and returns plain data. It
// imports nothing in this repository and nothing touching React, Next.js,
// tRPC, the ORM, HTTP or a database client — enforced by dependency-cruiser,
// not by convention.
export * from "./money/index.js";
export * from "./time/index.js";
