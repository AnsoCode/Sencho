#!/usr/bin/env node
// Scaffolds a release blog post in the Sencho website repo when the tag that
// triggered this run completes a run of 5 releases since the last post's anchor.
// Invoked by .github/workflows/release-blog-scaffold.yml. See website/CLAUDE.md
// for the cadence rules this script enforces.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const TEMPLATE_PATH = join(REPO_ROOT, '.github', 'release-blog-template.tsx.tmpl')

const WINDOW_SIZE = 5
// Section names come from release-please-config.json's changelog-sections.
// Security gets its own bucket so hardening items do not get lost.
const SECTION_MAP = {
  Added: 'added',
  Fixed: 'fixed',
  Changed: 'changed',
  Security: 'fixed',
}

function parseArgs(argv) {
  const args = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--tag') args.tag = argv[++i]
    else if (a === '--changelog') args.changelog = argv[++i]
    else if (a === '--website') args.website = argv[++i]
  }
  if (!args.tag || !args.changelog || !args.website) {
    throw new Error('Usage: --tag vX.Y.Z --changelog <path> --website <path> [--dry-run]')
  }
  return args
}

function stripV(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

function semverTuple(v) {
  return v.split('.').map((n) => {
    const x = Number.parseInt(n, 10)
    if (Number.isNaN(x)) throw new Error(`Bad semver segment: ${v}`)
    return x
  })
}

function cmpSemver(a, b) {
  const ta = semverTuple(a)
  const tb = semverTuple(b)
  for (let i = 0; i < 3; i++) {
    if ((ta[i] ?? 0) !== (tb[i] ?? 0)) return (ta[i] ?? 0) - (tb[i] ?? 0)
  }
  return 0
}

function findLastAnchor(websiteRoot) {
  const postsDir = join(websiteRoot, 'src', 'data', 'blog', 'posts')
  if (!existsSync(postsDir)) return null
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.tsx'))
  const versions = []
  for (const f of files) {
    const body = readFileSync(join(postsDir, f), 'utf8')
    if (!/category:\s*['"]release['"]/m.test(body)) continue
    const m = body.match(/version:\s*['"]([0-9]+\.[0-9]+\.[0-9]+)['"]/)
    if (m) versions.push(m[1])
  }
  if (versions.length === 0) return null
  versions.sort(cmpSemver)
  return versions[versions.length - 1]
}

function listTags() {
  const out = execFileSync('git', ['tag', '--sort=creatordate', '--list', 'v*'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return out.split('\n').map((s) => s.trim()).filter((s) => /^v\d+\.\d+\.\d+$/.test(s))
}

function windowSinceAnchor(tags, anchor, tag) {
  const tagIdx = tags.indexOf(tag)
  if (tagIdx === -1) {
    throw new Error(`Tag ${tag} not found in repo tag list`)
  }
  if (!anchor) {
    // No prior release post: treat every tag up to and including this one as the window.
    return tags.slice(0, tagIdx + 1)
  }
  const anchorTag = `v${anchor}`
  const anchorIdx = tags.indexOf(anchorTag)
  if (anchorIdx === -1) {
    // Anchor tag was deleted or renamed. Fall back to bootstrap so the run does
    // not hard-fail; a human will still review the resulting PR.
    console.warn(`WARN: anchor tag ${anchorTag} not found; falling back to bootstrap window`)
    return tags.slice(0, tagIdx + 1)
  }
  return tags.slice(anchorIdx + 1, tagIdx + 1)
}

function parseChangelog(changelogPath, versionsInWindow) {
  const body = readFileSync(changelogPath, 'utf8')
  // Locate every version heading by anchored regex. Splitting on raw `## [`
  // would also match occurrences inside prose or code fences.
  const headingRe = /^## \[([0-9]+\.[0-9]+\.[0-9]+)\][^\n]*$/gm
  const headings = []
  let h
  while ((h = headingRe.exec(body)) !== null) {
    headings.push({ version: h[1], start: h.index })
  }
  const perVersion = new Map()
  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length ? headings[i + 1].start : body.length
    perVersion.set(headings[i].version, body.slice(headings[i].start, end))
  }

  const grouped = { added: [], fixed: [], changed: [] }
  for (const v of versionsInWindow) {
    const block = perVersion.get(v)
    if (!block) {
      console.warn(`WARN: no CHANGELOG entry for ${v}`)
      continue
    }
    const sections = block.split(/^### /m).slice(1)
    for (const s of sections) {
      const nameMatch = s.match(/^([^\n]+)\n/)
      if (!nameMatch) continue
      const sectionName = nameMatch[1].trim()
      const bucket = SECTION_MAP[sectionName]
      if (!bucket) continue
      const lines = s.split('\n').slice(1)
      for (const line of lines) {
        if (!line.startsWith('* ')) continue
        let item = line.slice(2).trim()
        // Strip trailing "([...](url))" groups (PR link, commit SHA) repeatedly
        // since release-please emits both.
        const tail = /\s*\(\[[^\]]+\]\([^)]+\)\)\s*$/u
        while (tail.test(item)) item = item.replace(tail, '').trim()
        if (item.length > 0) grouped[bucket].push(item)
      }
    }
  }
  return grouped
}

function escapeTsxString(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function renderChangelogBlock(type, items) {
  if (items.length === 0) return ''
  const rendered = items.map((it) => `          '${escapeTsxString(it)}',`).join('\n')
  return `      <ChangelogSection
        type="${type}"
        items={[
${rendered}
        ]}
      />
`
}

function exportNameFor(version) {
  // Underscore-separated so e.g. 0.54.0 and 0.5.40 never collide, and so the
  // scheme stays unambiguous once we ship 1.0+.
  return `v${version.replace(/\./g, '_')}Release`
}

function slugFor(version) {
  return `v${version.replace(/\./g, '-')}-release`
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function renderPost(version, coveredVersions, grouped) {
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  const replacements = {
    __EXPORT_NAME__: exportNameFor(version),
    __SLUG__: slugFor(version),
    __VERSION__: version,
    __DATE__: todayIso(),
    __COVERED_VERSIONS__: coveredVersions.join(', '),
    __ADDED_BLOCK__: renderChangelogBlock('added', grouped.added),
    __FIXED_BLOCK__: renderChangelogBlock('fixed', grouped.fixed),
    __CHANGED_BLOCK__: renderChangelogBlock('changed', grouped.changed),
  }
  let out = template
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(k).join(v)
  }
  return out
}

function updateIndex(websiteRoot, exportName, fileBase) {
  const indexPath = join(websiteRoot, 'src', 'data', 'blog', 'index.ts')
  const body = readFileSync(indexPath, 'utf8')
  const importLine = `import { ${exportName} } from './posts/${fileBase}'`
  if (body.includes(importLine)) return body
  const lines = body.split('\n')
  let lastImportIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('import ')) lastImportIdx = i
  }
  if (lastImportIdx === -1) throw new Error('No imports found in index.ts')
  lines.splice(lastImportIdx + 1, 0, importLine)

  const joined = lines.join('\n')
  const arrayRegex = /(export const blogPosts: BlogPost\[\] = \[)([\s\S]*?)(\n\])/
  const m = joined.match(arrayRegex)
  if (!m) throw new Error('Could not locate blogPosts array in index.ts')
  const before = joined.slice(0, m.index)
  const arrOpen = m[1]
  const arrBody = m[2]
  const arrClose = m[3]
  const after = joined.slice(m.index + m[0].length)
  const newBody = `${arrBody.replace(/\s*$/u, '')}\n  ${exportName},`
  return `${before}${arrOpen}${newBody}${arrClose}${after}`
}

function renderPrBody(tag, version, coveredVersions) {
  const screenshotName = `${slugFor(version)}.png`
  return [
    `Scaffolded automatically from the \`${tag}\` tag on the Sencho repo.`,
    `Covers versions: \`${coveredVersions.join(', ')}\`.`,
    '',
    '## Before marking ready',
    '',
    '- [ ] Write the narrative intro (replace the TODO paragraph)',
    '- [ ] Set the title to something user-facing (replace `TODO headline`)',
    '- [ ] Fill in the SEO description (~160 chars)',
    `- [ ] Capture a headline screenshot and drop it at \`public/screenshots/${screenshotName}\``,
    '- [ ] Add at least one link to https://docs.sencho.io/',
    '- [ ] Finalize `readingTime`',
    '- [ ] Review the grouped changelog items, trim or rephrase any that read too much like commit messages',
    '',
  ].join('\n')
}

function writeGithubOutput(kv) {
  const out = process.env.GITHUB_OUTPUT
  if (!out) return
  const lines = Object.entries(kv).map(([k, v]) => `${k}=${v}`)
  writeFileSync(out, lines.join('\n') + '\n', { flag: 'a' })
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const newVersion = stripV(args.tag)

  const lastAnchor = findLastAnchor(args.website)
  console.log(`Last anchor: ${lastAnchor ?? '(none, bootstrap)'}`)

  const tags = listTags()
  const windowTags = windowSinceAnchor(tags, lastAnchor, args.tag)
  const windowVersions = windowTags.map(stripV)
  console.log(`Window (${windowTags.length}): ${windowTags.join(', ')}`)

  if (windowTags.length < WINDOW_SIZE) {
    console.log(`scaffold=false (count ${windowTags.length} < ${WINDOW_SIZE})`)
    writeGithubOutput({ scaffold: 'false' })
    return
  }
  if (windowTags.length % WINDOW_SIZE !== 0) {
    console.log(`scaffold=false (count ${windowTags.length} not divisible by ${WINDOW_SIZE})`)
    writeGithubOutput({ scaffold: 'false' })
    return
  }
  if (windowTags.length > WINDOW_SIZE) {
    console.warn(
      `WARN: window size ${windowTags.length} exceeds ${WINDOW_SIZE}. A prior scaffold was likely skipped; rolling up all ${windowTags.length} versions.`,
    )
  }

  const grouped = parseChangelog(args.changelog, windowVersions)
  console.log(
    `Collected items: added=${grouped.added.length}, fixed=${grouped.fixed.length}, changed=${grouped.changed.length}`,
  )

  const post = renderPost(newVersion, windowVersions, grouped)
  const date = todayIso()
  const fileBase = `${date}-${slugFor(newVersion)}`
  const postPath = join(args.website, 'src', 'data', 'blog', 'posts', `${fileBase}.tsx`)
  const indexPath = join(args.website, 'src', 'data', 'blog', 'index.ts')
  const newIndex = updateIndex(args.website, exportNameFor(newVersion), fileBase)

  const prBody = renderPrBody(args.tag, newVersion, windowVersions)
  const bodyFile = join(process.env.RUNNER_TEMP ?? tmpdir(), 'release-post-pr-body.md')

  if (args.dryRun) {
    console.log('\n--- Post file (dry-run): ' + postPath)
    console.log(post)
    console.log('\n--- index.ts (dry-run): ' + indexPath)
    console.log(newIndex)
    console.log('\n--- PR body (dry-run): ' + bodyFile)
    console.log(prBody)
  } else {
    writeFileSync(postPath, post, 'utf8')
    writeFileSync(indexPath, newIndex, 'utf8')
    writeFileSync(bodyFile, prBody, 'utf8')
    console.log(`Wrote ${postPath}`)
    console.log(`Updated ${indexPath}`)
    console.log(`Wrote PR body: ${bodyFile}`)
  }

  writeGithubOutput({
    scaffold: 'true',
    version: newVersion,
    slug: slugFor(newVersion),
    branch: `release-post/${args.tag}`,
    post_path: `src/data/blog/posts/${fileBase}.tsx`,
    body_file: bodyFile,
    covered: windowVersions.join(','),
  })
}

main()
