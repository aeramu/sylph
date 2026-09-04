export interface AvailableModel {
  id: string;
  provider: string;
}

export function findAvailableModel<T extends AvailableModel>(models: readonly T[], value: string): T | undefined {
  return value.includes("/")
    ? models.find((model) => `${model.provider}/${model.id}` === value)
    : models.find((model) => model.id === value);
}

export function isSameModel(current: AvailableModel | undefined, target: AvailableModel): boolean {
  return current?.provider === target.provider && current.id === target.id;
}
