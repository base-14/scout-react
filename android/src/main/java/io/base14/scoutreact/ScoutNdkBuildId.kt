package io.base14.scoutreact

import java.io.DataInputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipFile

/**
 * Parses the ELF .note.gnu.build-id from a shared library. The
 * build-id is stamped at link time by `ld --build-id` and identifies
 * a specific compile of the binary, which the backend uses to
 * symbolicate native crashes against the matching debug binary.
 *
 * Returns lower-hex of the build-id bytes, or null if not found.
 */
object ScoutNdkBuildId {
  fun readFile(path: String): String? {
    return try {
      RandomAccessFile(path, "r").use { raf ->
        readFromSeekable(SeekableRaf(raf))
      }
    } catch (_: Throwable) {
      null
    }
  }

  fun readFromApk(apkPath: String, entryName: String): String? {
    return try {
      ZipFile(apkPath).use { zip ->
        val entry = zip.getEntry(entryName) ?: return null
        zip.getInputStream(entry).use { stream ->
          val bytes = stream.readBytes()
          readFromSeekable(SeekableBytes(bytes))
        }
      }
    } catch (_: Throwable) {
      null
    }
  }

  private interface Seekable {
    fun seek(pos: Long)
    fun readFully(dst: ByteArray)
  }

  private class SeekableRaf(private val raf: RandomAccessFile) : Seekable {
    override fun seek(pos: Long) { raf.seek(pos) }
    override fun readFully(dst: ByteArray) { raf.readFully(dst) }
  }

  private class SeekableBytes(private val bytes: ByteArray) : Seekable {
    private var pos = 0
    override fun seek(pos: Long) { this.pos = pos.toInt() }
    override fun readFully(dst: ByteArray) {
      if (pos + dst.size > bytes.size) throw java.io.EOFException()
      System.arraycopy(bytes, pos, dst, 0, dst.size)
      pos += dst.size
    }
  }

  private fun readFromSeekable(s: Seekable): String? {
    val elfIdent = ByteArray(16)
    s.readFully(elfIdent)
    if (elfIdent[0] != 0x7f.toByte() ||
        elfIdent[1] != 'E'.code.toByte() ||
        elfIdent[2] != 'L'.code.toByte() ||
        elfIdent[3] != 'F'.code.toByte()) return null
    val is64 = elfIdent[4] == 2.toByte()
    val isLE = elfIdent[5] == 1.toByte()
    if (!is64 || !isLE) return null

    val hdr = ByteBuffer.allocate(48).order(ByteOrder.LITTLE_ENDIAN)
    s.readFully(hdr.array())
    hdr.short  // e_type
    hdr.short  // e_machine
    hdr.int    // e_version
    hdr.long   // e_entry
    val phoff = hdr.long
    hdr.long   // e_shoff
    hdr.int    // e_flags
    hdr.short  // e_ehsize
    val phentsize = hdr.short.toInt() and 0xffff
    val phnum = hdr.short.toInt() and 0xffff

    val PT_NOTE = 4
    val NT_GNU_BUILD_ID = 3
    for (i in 0 until phnum) {
      s.seek(phoff + i.toLong() * phentsize.toLong())
      val ph = ByteBuffer.allocate(56).order(ByteOrder.LITTLE_ENDIAN)
      s.readFully(ph.array())
      val pType = ph.int
      ph.int       // p_flags
      val pOffset = ph.long
      ph.long      // p_vaddr
      ph.long      // p_paddr
      val pFilesz = ph.long
      ph.long      // p_memsz
      ph.long      // p_align
      if (pType != PT_NOTE) continue
      val notesEnd = pOffset + pFilesz
      var cursor = pOffset
      while (cursor + 12 <= notesEnd) {
        s.seek(cursor)
        val noteHdr = ByteBuffer.allocate(12).order(ByteOrder.LITTLE_ENDIAN)
        s.readFully(noteHdr.array())
        val namesz = noteHdr.int
        val descsz = noteHdr.int
        val type = noteHdr.int
        val nameStart = cursor + 12
        val descStart = nameStart + ((namesz + 3) and 3.inv())
        if (type == NT_GNU_BUILD_ID && namesz == 4) {
          val name = ByteArray(4)
          s.seek(nameStart)
          s.readFully(name)
          if (name[0] == 'G'.code.toByte() &&
              name[1] == 'N'.code.toByte() &&
              name[2] == 'U'.code.toByte()) {
            val desc = ByteArray(descsz)
            s.seek(descStart)
            s.readFully(desc)
            return desc.joinToString("") { "%02x".format(it) }
          }
        }
        cursor = descStart + ((descsz + 3) and 3.inv()).toLong()
      }
    }
    return null
  }

  @Suppress("unused")
  private fun unusedImports(): InputStream? = DataInputStream(null).let { null }
}
