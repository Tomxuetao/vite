function crash(message) {
    throw new Error(message);
}
export function main() {
    crash('crash');
}
