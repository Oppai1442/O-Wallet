export {}

declare global {
  interface BooleanConstructor {
    /** Runtime Boolean already rejects nullish values in truthy checks; expose that fact to strict TS control flow. */
    <T>(value?: T): value is NonNullable<T>
  }
}
