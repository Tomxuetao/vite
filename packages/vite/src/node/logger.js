/* eslint no-console: 0 */
import readline from 'node:readline'
import colors from 'picocolors'
export const LogLevels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
}
let lastType
let lastMsg
let sameCount = 0
function clearScreen() {
  const repeatCount = process.stdout.rows - 2
  const blank = repeatCount > 0 ? '\n'.repeat(repeatCount) : ''
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}
// Only initialize the timeFormatter when the timestamp option is used, and
// reuse it across all loggers
let timeFormatter
function getTimeFormatter() {
  timeFormatter ??= new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  return timeFormatter
}
export function createLogger(level = 'info', options = {}) {
  if (options.customLogger) {
    return options.customLogger
  }
  const loggedErrors = new WeakSet()
  const { prefix = '[vite]', allowClearScreen = true } = options
  const thresh = LogLevels[level]
  const canClearScreen =
    allowClearScreen && process.stdout.isTTY && !process.env.CI
  const clear = canClearScreen ? clearScreen : () => {}
  function format(type, msg, options = {}) {
    if (options.timestamp) {
      let tag = ''
      if (type === 'info') {
        tag = colors.cyan(colors.bold(prefix))
      } else if (type === 'warn') {
        tag = colors.yellow(colors.bold(prefix))
      } else {
        tag = colors.red(colors.bold(prefix))
      }
      return `${colors.dim(getTimeFormatter().format(new Date()))} ${tag} ${msg}`
    } else {
      return msg
    }
  }
  function output(type, msg, options = {}) {
    if (thresh >= LogLevels[type]) {
      const method = type === 'info' ? 'log' : type
      if (options.error) {
        loggedErrors.add(options.error)
      }
      if (canClearScreen) {
        if (type === lastType && msg === lastMsg) {
          sameCount++
          clear()
          console[method](
            format(type, msg, options),
            colors.yellow(`(x${sameCount + 1})`),
          )
        } else {
          sameCount = 0
          lastMsg = msg
          lastType = type
          if (options.clear) {
            clear()
          }
          console[method](format(type, msg, options))
        }
      } else {
        console[method](format(type, msg, options))
      }
    }
  }
  const warnedMessages = new Set()
  const logger = {
    hasWarned: false,
    info(msg, opts) {
      output('info', msg, opts)
    },
    warn(msg, opts) {
      logger.hasWarned = true
      output('warn', msg, opts)
    },
    warnOnce(msg, opts) {
      if (warnedMessages.has(msg)) return
      logger.hasWarned = true
      output('warn', msg, opts)
      warnedMessages.add(msg)
    },
    error(msg, opts) {
      logger.hasWarned = true
      output('error', msg, opts)
    },
    clearScreen(type) {
      if (thresh >= LogLevels[type]) {
        clear()
      }
    },
    hasErrorLogged(error) {
      return loggedErrors.has(error)
    },
  }
  return logger
}
export function printServerUrls(urls, optionsHost, info) {
  const colorUrl = (url) =>
    colors.cyan(url.replace(/:(\d+)\//, (_, port) => `:${colors.bold(port)}/`))
  for (const url of urls.local) {
    info(`  ${colors.green('➜')}  ${colors.bold('Local')}:   ${colorUrl(url)}`)
  }
  for (const url of urls.network) {
    info(`  ${colors.green('➜')}  ${colors.bold('Network')}: ${colorUrl(url)}`)
  }
  if (urls.network.length === 0 && optionsHost === undefined) {
    info(
      colors.dim(`  ${colors.green('➜')}  ${colors.bold('Network')}: use `) +
        colors.bold('--host') +
        colors.dim(' to expose'),
    )
  }
}
