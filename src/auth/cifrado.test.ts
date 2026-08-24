import { describe, expect, it } from 'vitest'
import { cifrar, descifrar, estaCifrado } from './cifrado'

const SECRETO = 'un secreto de pruebas suficientemente largo'
const TOKEN = 'EAAG9ZBxyz...token-de-system-user-de-meta'

describe('cifrado de credenciales', () => {
  it('devuelve el mismo texto al descifrar', () => {
    expect(descifrar(cifrar(TOKEN, SECRETO), SECRETO)).toBe(TOKEN)
  })

  it('cifra el mismo texto distinto cada vez', () => {
    // IV aleatorio por cifrado. Si dos tokens iguales dieran el mismo texto
    // cifrado, mirar la columna diría quién comparte credencial con quién.
    expect(cifrar(TOKEN, SECRETO)).not.toBe(cifrar(TOKEN, SECRETO))
  })

  it('no revela el texto original en lo guardado', () => {
    expect(cifrar(TOKEN, SECRETO)).not.toContain('system-user')
  })

  it('conserva acentos y emoji', () => {
    const texto = 'clave con ñ, tildes áéí y 🔐'
    expect(descifrar(cifrar(texto, SECRETO), SECRETO)).toBe(texto)
  })

  it('conserva el texto vacío', () => {
    expect(descifrar(cifrar('', SECRETO), SECRETO)).toBe('')
  })

  it('falla con la clave equivocada', () => {
    const guardado = cifrar(TOKEN, SECRETO)
    expect(() => descifrar(guardado, 'otro secreto igual de largo!!')).toThrow()
  })

  it('falla si alguien editó el texto cifrado en la base', () => {
    // Lo que aporta GCM sobre CBC: un byte cambiado se detecta en vez de
    // devolver basura que después se manda a Meta.
    const partes = cifrar(TOKEN, SECRETO).split('$')
    const cuerpo = Buffer.from(partes[3], 'base64url')
    cuerpo[0] ^= 0xff
    partes[3] = cuerpo.toString('base64url')

    expect(() => descifrar(partes.join('$'), SECRETO)).toThrow()
  })

  it('falla si alguien cambió la etiqueta de autenticación', () => {
    const partes = cifrar(TOKEN, SECRETO).split('$')
    const tag = Buffer.from(partes[2], 'base64url')
    tag[0] ^= 0xff
    partes[2] = tag.toString('base64url')

    expect(() => descifrar(partes.join('$'), SECRETO)).toThrow()
  })

  it('rechaza un formato que no reconoce', () => {
    expect(() => descifrar('el-token-en-claro', SECRETO)).toThrow(/formato/i)
    expect(() => descifrar('gcm1$a$b', SECRETO)).toThrow(/formato/i)
  })

  it('rechaza un IV de largo inválido', () => {
    const partes = cifrar(TOKEN, SECRETO).split('$')
    partes[1] = Buffer.alloc(8).toString('base64url')
    expect(() => descifrar(partes.join('$'), SECRETO)).toThrow(/largo inválido/i)
  })

  it('exige un secreto que valga la pena', () => {
    // Un secreto corto derivado con scrypt sigue siendo un secreto corto.
    expect(() => cifrar(TOKEN, 'corto')).toThrow(/corto/i)
  })

  it('reconoce lo que ya está cifrado', () => {
    expect(estaCifrado(cifrar(TOKEN, SECRETO))).toBe(true)
    expect(estaCifrado(TOKEN)).toBe(false)
  })
})
