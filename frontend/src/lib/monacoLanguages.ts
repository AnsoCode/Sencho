export function extensionToLanguage(filename: string): string {
  if (filename === 'Dockerfile') return 'dockerfile';

  // Dotfiles with no secondary dot (e.g. ".gitignore") have no meaningful
  // extension, but ".env*" files should be treated as ini.
  const basename = filename.includes('/') ? filename.slice(filename.lastIndexOf('/') + 1) : filename;

  if (basename.startsWith('.env')) return 'ini';

  const dotIndex = basename.lastIndexOf('.');

  // No extension, or the only dot is the leading dot of a dotfile.
  if (dotIndex <= 0) return 'plaintext';

  const ext = basename.slice(dotIndex).toLowerCase();

  switch (ext) {
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.json':
    case '.jsonc':
      return 'json';
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'shell';
    case '.py':
      return 'python';
    case '.toml':
      return 'ini';
    case '.ini':
    case '.conf':
    case '.cfg':
      return 'ini';
    case '.xml':
    case '.html':
    case '.htm':
      return 'html';
    case '.css':
      return 'css';
    case '.md':
    case '.mdx':
      return 'markdown';
    default:
      return 'plaintext';
  }
}
