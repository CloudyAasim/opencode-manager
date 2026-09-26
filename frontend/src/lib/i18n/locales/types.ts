export type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>
}
