import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Heading,
  Text,
  ProgressCircle,
  SearchField,
  ActionButton,
  Flex,
  Divider
} from '@adobe/react-spectrum'
import Refresh from '@spectrum-icons/workflow/Refresh'
import Copy from '@spectrum-icons/workflow/Copy'
import Download from '@spectrum-icons/workflow/Download'
import ChevronUp from '@spectrum-icons/workflow/ChevronUp'
import './DocumentationPage.css'

/**
 * Documentation Page Component
 * 
 * Fetches DOCUMENTATION.md from the GitHub repository raw URL (or local fallback),
 * parses Markdown to HTML client-side, and renders it with navigation, search, and TOC.
 * 
 * The documentation is auto-generated from docs/features/*.md via `npm run build:docs`
 * and committed to the repo. This component always shows the latest committed version.
 */

// Simple Markdown to HTML parser (no external dependencies)
function markdownToHtml (md) {
  let html = md

  // Escape HTML entities in code blocks first (protect them)
  const codeBlocks = []
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    codeBlocks.push(`<pre class="doc-code-block"><code class="language-${lang || 'text'}">${escaped}</code></pre>`)
    return `%%CODEBLOCK_${idx}%%`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="doc-inline-code">$1</code>')

  // Headers (h1-h6) with IDs for anchor links
  html = html.replace(/^######\s+(.+)$/gm, (_, t) => `<h6 id="${slugify(t)}" class="doc-heading">${t}</h6>`)
  html = html.replace(/^#####\s+(.+)$/gm, (_, t) => `<h5 id="${slugify(t)}" class="doc-heading">${t}</h5>`)
  html = html.replace(/^####\s+(.+)$/gm, (_, t) => `<h4 id="${slugify(t)}" class="doc-heading">${t}</h4>`)
  html = html.replace(/^###\s+(.+)$/gm, (_, t) => `<h3 id="${slugify(t)}" class="doc-heading">${t}</h3>`)
  html = html.replace(/^##\s+(.+)$/gm, (_, t) => `<h2 id="${slugify(t)}" class="doc-heading">${t}</h2>`)
  html = html.replace(/^#\s+(.+)$/gm, (_, t) => `<h1 id="${slugify(t)}" class="doc-heading">${t}</h1>`)

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="doc-blockquote">$1</blockquote>')

  // Tables
  html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (match, header, body) => {
    const headers = header.split('|').map(h => h.trim()).filter(Boolean)
    const rows = body.trim().split('\n').map(row =>
      row.split('|').map(c => c.trim()).filter(Boolean)
    )
    let table = '<div class="doc-table-wrapper"><table class="doc-table"><thead><tr>'
    headers.forEach(h => { table += `<th>${h}</th>` })
    table += '</tr></thead><tbody>'
    rows.forEach(row => {
      table += '<tr>'
      row.forEach(cell => { table += `<td>${cell}</td>` })
      table += '</tr>'
    })
    table += '</tbody></table></div>'
    return table
  })

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="doc-link">$1</a>')

  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, '<ul class="doc-list">$1</ul>')

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr class="doc-divider" />')

  // Paragraphs (lines that aren't already HTML)
  html = html.replace(/^(?!<[a-z/]|%%CODEBLOCK)(.+)$/gm, (match, text) => {
    if (text.trim() === '') return ''
    return `<p class="doc-paragraph">${text}</p>`
  })

  // Restore code blocks
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, idx) => codeBlocks[parseInt(idx)])

  // Clean up empty lines
  html = html.replace(/\n{3,}/g, '\n\n')

  return html
}

function slugify (text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// Extract TOC from markdown headings
function extractToc (md) {
  const headings = []
  const lines = md.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/[`*[\]()]/g, ''),
        id: slugify(match[2])
      })
    }
  }
  return headings
}

export default function DocumentationPage () {
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [tocVisible, setTocVisible] = useState(true)
  const [activeSection, setActiveSection] = useState('')
  const contentRef = useRef(null)

  // Fetch documentation from GitHub raw URL or fallback
  const fetchDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Try fetching from the repo's raw content URL
      // This will be configured per deployment - adjust the URL pattern
      const possibleUrls = [
        // GitHub raw URL (replace with actual repo details)
        `${window.location.origin}/DOCUMENTATION.md`,
        // Fallback: relative path (works in local dev)
        '/DOCUMENTATION.md'
      ]

      let content = null
      for (const url of possibleUrls) {
        try {
          const resp = await fetch(url)
          if (resp.ok) {
            content = await resp.text()
            break
          }
        } catch (e) {
          // Try next URL
        }
      }

      if (!content) {
        // Hardcoded fallback message if file can't be fetched
        content = `# Documentation Not Available

The documentation file could not be loaded. 

To generate it, run:
\`\`\`bash
npm run build:docs
\`\`\`

Then commit and push the generated \`DOCUMENTATION.md\` file.

The documentation is built from individual feature files in \`docs/features/\`.
`
      }

      setMarkdown(content)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])

  // Track active section on scroll
  useEffect(() => {
    if (!contentRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' }
    )

    const headings = contentRef.current.querySelectorAll('[id]')
    headings.forEach(h => observer.observe(h))

    return () => observer.disconnect()
  }, [markdown, loading])

  // Search/filter functionality
  const filteredHtml = React.useMemo(() => {
    if (!markdown) return ''
    if (!searchQuery) return markdownToHtml(markdown)

    // Highlight search matches in rendered HTML
    const html = markdownToHtml(markdown)
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return html.replace(regex, '<mark class="doc-search-highlight">$1</mark>')
  }, [markdown, searchQuery])

  const toc = React.useMemo(() => extractToc(markdown), [markdown])

  const scrollToTop = () => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }

  const handleCopyLink = () => {
    const url = window.location.href.split('#')[0]
    if (activeSection) {
      navigator.clipboard.writeText(`${url}#${activeSection}`)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'DOCUMENTATION.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <View UNSAFE_className='mdm-page'>
        <View padding='size-400' UNSAFE_style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          <ProgressCircle aria-label='Loading documentation...' isIndeterminate size='L' />
          <Text marginStart='size-200'>Loading documentation...</Text>
        </View>
      </View>
    )
  }

  if (error) {
    return (
      <View UNSAFE_className='mdm-page'>
        <View padding='size-400'>
          <Heading level={2}>Documentation Error</Heading>
          <Text>{error}</Text>
          <ActionButton onPress={fetchDocs} marginTop='size-200'>
            <Refresh />
            <Text>Retry</Text>
          </ActionButton>
        </View>
      </View>
    )
  }

  return (
    <View UNSAFE_className='mdm-page'>
      {/* Header toolbar */}
      <div className='doc-header'>
        <Flex alignItems='center' gap='size-200' flex={1}>
          <Heading level={2} UNSAFE_style={{ margin: 0 }}>Technical Documentation</Heading>
        </Flex>
        <Flex alignItems='center' gap='size-100'>
          <SearchField
            placeholder='Search documentation...'
            value={searchQuery}
            onChange={setSearchQuery}
            width='size-3000'
            aria-label='Search documentation'
          />
          <ActionButton onPress={handleCopyLink} isQuiet aria-label='Copy link to section'>
            <Copy />
          </ActionButton>
          <ActionButton onPress={handleDownload} isQuiet aria-label='Download markdown'>
            <Download />
          </ActionButton>
          <ActionButton onPress={fetchDocs} isQuiet aria-label='Refresh'>
            <Refresh />
          </ActionButton>
        </Flex>
      </div>

      <Divider size='S' />

      {/* Main content area with optional TOC sidebar */}
      <div className='doc-layout'>
        {/* Table of Contents sidebar */}
        {tocVisible && toc.length > 0 && (
          <aside className='doc-toc'>
            <div className='doc-toc__header'>
              <Text UNSAFE_className='doc-toc__title'>Contents</Text>
              <ActionButton isQuiet onPress={() => setTocVisible(false)} aria-label='Hide TOC'>
                <ChevronUp />
              </ActionButton>
            </div>
            <nav className='doc-toc__nav'>
              {toc.map((item, idx) => (
                <a
                  key={idx}
                  href={`#${item.id}`}
                  className={`doc-toc__link doc-toc__link--level-${item.level} ${activeSection === item.id ? 'doc-toc__link--active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    const el = document.getElementById(item.id)
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {item.text}
                </a>
              ))}
            </nav>
          </aside>
        )}

        {/* Documentation content */}
        <article
          ref={contentRef}
          className='doc-content'
          dangerouslySetInnerHTML={{ __html: filteredHtml }}
        />
      </div>

      {/* Scroll to top FAB */}
      <button className='doc-scroll-top' onClick={scrollToTop} aria-label='Scroll to top'>
        <ChevronUp size='S' />
      </button>
    </View>
  )
}
