export function playAnotherMatch(
  leave: () => void,
  navigate: (url: string) => void,
): void {
  leave();
  navigate("/");
}
