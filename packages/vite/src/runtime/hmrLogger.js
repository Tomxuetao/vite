const noop = () => {}
export const silentConsole = {
  debug: noop,
  error: noop,
}
