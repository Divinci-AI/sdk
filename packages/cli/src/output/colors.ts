import chalk from "chalk";

let colorsEnabled = true;

export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled;
}

function wrap(fn: (s: string) => string): (s: string) => string {
  return (s: string) => (colorsEnabled ? fn(s) : s);
}

export const colors = {
  bold: wrap(chalk.bold),
  dim: wrap(chalk.dim),
  green: wrap(chalk.green),
  red: wrap(chalk.red),
  yellow: wrap(chalk.yellow),
  cyan: wrap(chalk.cyan),
  blue: wrap(chalk.blue),
  magenta: wrap(chalk.magenta),
  gray: wrap(chalk.gray),
  white: wrap(chalk.white),
  greenBold: wrap((s) => chalk.green.bold(s)),
  redBold: wrap((s) => chalk.red.bold(s)),
  cyanBold: wrap((s) => chalk.cyan.bold(s)),
  yellowBold: wrap((s) => chalk.yellow.bold(s)),
};
