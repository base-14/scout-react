let _suppressing = false;
export function isSuppressingSdkErrors(): boolean {
  return _suppressing;
}
export function withSuppression<T>(fn: () => T): T {
  _suppressing = true;
  try {
    return fn();
  } finally {
    _suppressing = false;
  }
}
