// ASCII banner, edited as two parallel grids.
//
// SHAPE holds the raw glyphs (braille art + figlet text). Leave these alone
// unless you want to change the art itself.
//
// COLORS is the paint map. Each character corresponds 1:1 to the character
// at the same position in SHAPE:
//   B = blue accent — the sphere
//   S = default foreground — the rings and the "Bitsocial" text
//   . = no color (pass the glyph through as-is; use this for spaces)
//
// To retouch the art, find a glyph in SHAPE, then flip the character at the
// same column in the matching COLORS row. A common case: a ring cell came out
// blue because the sphere mask had more dots there — change its 'B' to 'S'.
//
// Both grids MUST have the same number of rows. Each row in COLORS must be at
// least as wide as the corresponding SHAPE row (extra chars are ignored).
// Use the terminal's default foreground for the wordmark/rings so the banner
// stays readable on both light and dark terminal themes.

const SHAPE = [
    "                ⢀⣴⣿⣿⣦⡀                                                                                       ",
    "                ⣾⣿⠁⠈⣿⣷⡀                                                                                      ",
    "               ⢸⣿⡇  ⢸⣿⣇                                                                                      ",
    "             ⢀⣀⣼⣿⣷⣶⣶⣶⣿⣿⣄⡀                                                                                    ",
    "          ⢀⣠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣤⡀                                                                                 ",
    "         ⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦               888888b.   d8b 888                               d8b          888",
    "       ⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀             888  \"88b  Y8P 888                               Y8P          888",
    "  ⣀⣤⣤⣶⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣶⣦⣤⣀        888  .88P      888                                            888",
    "⣰⣿⡿⠛⠉⠉ ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ ⠉⠉⠛⠟⣿⣦      8888888K.  888 888888 .d8888b   .d88b.   .d8888b 888  8888b.  888",
    "⠻⣷⣦⣤⣀⣀ ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿ ⢀⣀⣀⣴⣿⠟      888  \"Y88b 888 888    88K      d88\"\"88b d88P\"    888     \"88b 888",
    "  ⠉⠛⠻⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⠟⠛⠉        888    888 888 888    \"Y8888b. 888  888 888      888 .d888888 888",
    "       ⠈⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿              888   d88P 888 Y88b.       X88 Y88..88P Y88b.    888 888  888 888",
    "         ⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟               8888888P\"  888  \"Y888  88888P'  \"Y88P\"   \"Y8888P 888 \"Y888888 888",
    "          ⠈⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠁                                                                                 ",
    "             ⠉⠛⢿⣿⣿⣿⣿⣿⣿⣿⠛⠉                                                                                    ",
    "                ⢸⣿⡆  ⣿⡿                                                                                      ",
    "                ⠈⢿⣷⡀⣸⣿⠃                                                                                       ",
    "                 ⠈⠿⣿⡿⠃                                                                                        "
];

const COLORS = [
    "................SSSSSS.......................................................................................",
    "................SSSSSSS......................................................................................",
    "...............SSSSSSSS......................................................................................",
    ".............BBBBBBBBSSBB....................................................................................",
    "..........BBBBBBBBBBBSSBBBBB.................................................................................",
    ".........BBBBBBBBBBBBSSBBBBBB...............SSSSSSSS...SSS.SSS...............................SSS..........SSS",
    ".......BBBBBBBBBBBBBBSSBBBBBBBB.............SSS..SSSS..SSS.SSS...............................SSS..........SSS",
    "..SSSSSBBBBBBBBBBBBBBSSBBBBBBBBSSSSSSS......SSS..SSSS......SSS............................................SSS",
    "SSSSSS.BBBBBBBBBBBBBBSSBBBBBBBBSSSSSSS......SSSSSSSSS..SSS.SSSSSS.SSSSSSS...SSSSSS...SSSSSSS.SSS..SSSSSS..SSS",
    "SSSSSS.BBBBBBBBBBBBBBSSBBBBBBBBSSSSSSS......SSS..SSSSS.SSS.SSS....SSS......SSSSSSSS.SSSSS....SSS.....SSSS.SSS",
    "..SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS......SSS....SSS.SSS.SSS....SSSSSSSS.SSS..SSS.SSS......SSS.SSSSSSSS.SSS",
    ".......BBBBBBBBBBBBBBSSBBBBBBBBBBBBBBB......SSS...SSSS.SSS.SSSSS.......SSS.SSSSSSSS.SSSSS....SSS.SSS..SSS.SSS",
    ".........BBBBBBBBBBBBSSBBBBBBBBB............SSSSSSSSS..SSS..SSSSS..SSSSSSS..SSSSSS...SSSSSSS.SSS.SSSSSSSS.SSS",
    "..........BBBBBBBBBBBSSBBBBBBB...............................................................................",
    ".............BBBBBBBBSSBBBB..................................................................................",
    "...............SSSSSSSSS.....................................................................................",
    "...............SSSSSSSS......................................................................................",
    "................SSSSSS......................................................................................."
];

const BLUE = "\x1b[94m";
const DEFAULT_FOREGROUND = "\x1b[39m";

function paint(shape: string, colors: string): string {
    let out = "";
    let blueActive = false;
    for (let i = 0; i < shape.length; i++) {
        const glyph = shape[i]!;
        const want = colors[i] ?? ".";
        const wantBlue = want === "B";
        if (wantBlue !== blueActive) {
            out += wantBlue ? BLUE : DEFAULT_FOREGROUND;
            blueActive = wantBlue;
        }
        out += glyph;
    }
    if (blueActive) out += DEFAULT_FOREGROUND;
    return out;
}

interface RenderBannerOptions {
    env?: Record<string, string | undefined>;
    forceColor?: boolean;
    stdoutIsTTY?: boolean;
}

function envForcesColor(value: string | undefined): boolean {
    if (value === undefined) return false;
    return value !== "0" && value.toLowerCase() !== "false";
}

function supportsColor(options: RenderBannerOptions = {}): boolean {
    const env = options.env ?? process.env;
    if (env["NO_COLOR"] !== undefined) return false;
    if (options.forceColor) return true;
    if (env["FORCE_COLOR"] !== undefined) return envForcesColor(env["FORCE_COLOR"]);
    return Boolean(options.stdoutIsTTY ?? process.stdout.isTTY);
}

export function renderBanner(options: RenderBannerOptions = {}): string {
    const useColor = supportsColor(options);
    const lines = SHAPE.map((row, i) => (useColor ? paint(row, COLORS[i] ?? "") : row));
    return lines.join("\n") + "\n\n";
}

export function printBanner(options: RenderBannerOptions = {}): void {
    process.stdout.write(renderBanner(options));
}
