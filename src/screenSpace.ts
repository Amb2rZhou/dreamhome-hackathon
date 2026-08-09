/**
 * DreamHome keeps its original 390 × 844 logical coordinate space while the
 * device is rendered at the prototype specification (320 × 694).
 *
 * Pointer events report rendered CSS pixels, so interactions that store
 * absolute screen coordinates must be converted back into logical pixels.
 */
export function clientPointInElement(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  const logicalWidth = element.offsetWidth || rect.width
  const logicalHeight = element.offsetHeight || rect.height

  return {
    x: ((clientX - rect.left) / rect.width) * logicalWidth,
    y: ((clientY - rect.top) / rect.height) * logicalHeight,
  }
}
