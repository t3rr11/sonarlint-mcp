var legacy = "should prefer let/const";

export function boolReturn(input: number): boolean {
  if (input > 10) {
    return true;
  } else {
    return false;
  }
}

export function unusedParameter(a: number, b: number): number {
  return a + 1;
}

export function nestedCondition(x: number): string {
  if (x > 0) {
    if (x > 5) {
      return "big";
    }
  }
  return "small";
}

export const apiKey = "sk-proj-0123456789abcdef0123456789";
