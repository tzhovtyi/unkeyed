/** A model an adapter can ask for. A surface answering `models.list` decorates these. */
export type ModelDescriptor = {
  id: string;
  displayName: string;
  /** ISO 8601. */
  createdAt: string;
};
