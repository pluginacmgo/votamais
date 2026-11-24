import { useCallback, useEffect, useRef, useState } from 'react'
import Quill from 'quill'
import DOMPurify from 'dompurify'
import { AlignCenter, Bold, ImagePlus, Italic, Link2, List, Redo2, SeparatorHorizontal, Strikethrough, Type, Underline, Undo2 } from 'lucide-react'
import 'quill/dist/quill.snow.css'

export type EmailContent = { delta: object; html: string }
type Props = { initialDelta?: object; onChange?: (content: EmailContent) => void; onUploadImage?: (file: File) => Promise<string> }
const allowed = ['p','br','strong','b','em','i','u','s','ol','ul','li','h1','h2','h3','blockquote','a','img','span','hr']

export function EmailEditor({ initialDelta, onChange, onUploadImage }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const quill = useRef<Quill | null>(null)
  const callback = useRef(onChange)
  const startingDelta = useRef(initialDelta)
  const imagePicker = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [characters, setCharacters] = useState(0)
  useEffect(() => { callback.current = onChange }, [onChange])

  useEffect(() => {
    if (!host.current || quill.current) return
    const instance = new Quill(host.current, {
      theme: 'snow',
      formats: ['header','bold','italic','underline','strike','color','background','align','list','link','image','blockquote'],
      modules: { toolbar: false, history: { delay: 1000, maxStack: 100, userOnly: true } },
      placeholder: 'Escreva o conteúdo da sua mensagem…',
    })
    quill.current = instance
    if (startingDelta.current) instance.setContents(startingDelta.current as Parameters<Quill['setContents']>[0], 'silent')
    else instance.setText('')
    const handleChange = () => {
      const html = DOMPurify.sanitize(instance.root.innerHTML, { ALLOWED_TAGS: allowed, ALLOWED_ATTR: ['href','src','alt','width','height','style','class'] })
      setCharacters(instance.getText().trimEnd().length)
      callback.current?.({ delta: instance.getContents(), html })
    }
    instance.on('text-change', handleChange)
    return () => {
      instance.off('text-change', handleChange)
      quill.current = null
      if (host.current) host.current.innerHTML = ''
    }
  }, [])

  const run = useCallback((format: string, value?: string | boolean | number) => {
    const editor = quill.current
    if (!editor) return
    editor.focus()
    if (format === 'undo') { editor.history.undo(); return }
    if (format === 'redo') { editor.history.redo(); return }
    if (format === 'clean') {
      const range = editor.getSelection(true)
      editor.removeFormat(range.index, range.length)
      return
    }
    if (format === 'cta') {
      const range = editor.getSelection(true)
      editor.insertText(range.index, 'Conheça as novidades', { link: 'https://example.com', bold: true, color: '#28633c' })
      editor.setSelection(range.index + 20)
      return
    }
    if (format === 'divider') {
      const range = editor.getSelection(true)
      editor.insertText(range.index, '\n────────────────────────\n')
      return
    }
    if (format === 'footer') {
      const range = editor.getSelection(true)
      const footer = '\nVota Mais · Você recebe esta mensagem porque confirmou sua inscrição.\nCancelar inscrição: {{unsubscribe_url}}'
      editor.insertText(range.index, footer)
      editor.setSelection(range.index + footer.length)
      return
    }
    if (format === 'variable') {
      const range = editor.getSelection(true)
      editor.insertText(range.index, value as string)
      editor.setSelection(range.index + (value as string).length)
      return
    }
    if (format === 'link') {
      const url = window.prompt('Cole um endereço HTTPS')
      if (url && /^https:\/\//i.test(url)) editor.format('link', url)
      return
    }
    editor.format(format, value ?? !editor.getFormat()[format])
  }, [])

  async function insertImage(file?: File) {
    if (!file || !onUploadImage || !/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 5 * 1024 * 1024) return
    const url = await onUploadImage(file)
    if (!url.startsWith('https://')) return
    const editor = quill.current
    if (!editor) return
    const range = editor.getSelection(true)
    editor.insertEmbed(range.index, 'image', url, 'user')
    editor.setSelection(range.index + 1)
  }
  const safePreview = DOMPurify.sanitize(quill.current?.root.innerHTML ?? '', { ALLOWED_TAGS: allowed, ALLOWED_ATTR: ['href','src','alt','width','height','style','class'] })

  return <section className="email-editor"><div className="editor-toolbar"><div className="editor-tool-group"><button aria-label="Negrito" onClick={()=>run('bold')}><Bold size={16}/></button><button aria-label="Itálico" onClick={()=>run('italic')}><Italic size={16}/></button><button aria-label="Sublinhado" onClick={()=>run('underline')}><Underline size={16}/></button><button aria-label="Tachado" onClick={()=>run('strike')}><Strikethrough size={16}/></button></div><div className="editor-tool-group"><select aria-label="Título" defaultValue="" onChange={e=>run('header',e.target.value?Number(e.target.value):false)}><option value="">Texto</option><option value="1">H1</option><option value="2">H2</option><option value="3">H3</option></select><button aria-label="Lista não ordenada" onClick={()=>run('list','bullet')}><List size={16}/></button><button aria-label="Lista ordenada" onClick={()=>run('list','ordered')}>1.</button><button aria-label="Alinhar ao centro" onClick={()=>run('align','center')}><AlignCenter size={16}/></button><button aria-label="Link" onClick={()=>run('link')}><Link2 size={16}/></button><button aria-label="Citação" onClick={()=>run('blockquote')}>“</button><label className="editor-color" title="Cor do texto">A<input aria-label="Cor do texto" type="color" onChange={e=>run('color',e.target.value)}/></label><label className="editor-color" title="Cor de fundo">▰<input aria-label="Cor de fundo" type="color" onChange={e=>run('background',e.target.value)}/></label><button aria-label="Limpar formatação" onClick={()=>run('clean')}>Limpar</button></div><div className="editor-tool-group"><button aria-label="Variável primeiro nome" onClick={()=>run('variable','{{first_name}}')}><Type size={15}/> nome</button><button aria-label="Variável e-mail" onClick={()=>run('variable','{{email}}')}>e-mail</button><button aria-label="Variável descadastro" onClick={()=>run('variable','{{unsubscribe_url}}')}>descadastro</button><button aria-label="Variável empresa" onClick={()=>run('variable','{{company_name}}')}>empresa</button><button aria-label="Inserir CTA" onClick={()=>run('cta')}>CTA</button><button aria-label="Inserir divisor" onClick={()=>run('divider')}><SeparatorHorizontal size={16}/></button><button aria-label="Inserir rodapé" onClick={()=>run('footer')}>Rodapé</button><button aria-label="Inserir imagem" disabled={!onUploadImage} onClick={()=>imagePicker.current?.click()}><ImagePlus size={16}/></button></div><div className="editor-tool-group editor-history"><button aria-label="Desfazer" onClick={()=>run('undo')}><Undo2 size={16}/></button><button aria-label="Refazer" onClick={()=>run('redo')}><Redo2 size={16}/></button></div></div><input ref={imagePicker} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e=>void insertImage(e.target.files?.[0])}/>{preview?<div className={`email-preview ${mobile?'mobile':''}`}><div dangerouslySetInnerHTML={{__html:safePreview}}/></div>:<div ref={host} className="editor-canvas"/>}<div className="editor-footer"><span>{characters.toLocaleString('pt-BR')} caracteres</span><div><button onClick={()=>setMobile(false)} className={!mobile?'active':''}>Desktop</button><button onClick={()=>setMobile(true)} className={mobile?'active':''}>Mobile</button><button onClick={()=>setPreview(!preview)}>{preview?'Voltar ao editor':'Pré-visualizar'}</button></div></div></section>
}
