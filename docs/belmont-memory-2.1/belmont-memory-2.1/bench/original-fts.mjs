import { DatabaseSync } from 'node:sqlite';
// Behavior-faithful port of the inspected knowledge-store.ts query builder + weighted BM25.
// It is NOT a claim that the complete Belmont Electron host was launched.
const CJK_RUN=/[ㄱ-ㆎ가-힣一-鿿぀-ヿ]+/g,CJK_ANY=/[ㄱ-ㆎ가-힣一-鿿぀-ヿ]/;
function grams(text){const out=[];for(const run of text.match(CJK_RUN)??[]){if(run.length===1)out.push(run);for(let i=0;i+1<run.length;i++)out.push(run.slice(i,i+2));}return out;}
function query(raw){const terms=new Set();for(const w of raw.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu)??[]){if(CJK_ANY.test(w))for(const b of grams(w))terms.add(`ngrams:"${b}"`);else if(w.length>=2)terms.add(`"${w.replace(/"/g,'')}"*`);}return[...terms].join(' OR ');}
export class OriginalFtsBaseline{
 constructor(documents){this.db=new DatabaseSync(':memory:');this.db.exec("CREATE VIRTUAL TABLE k USING fts5(path UNINDEXED,title,aliases,body,ngrams,date UNINDEXED,tokenize='unicode61 remove_diacritics 2')");for(const d of documents)this.db.prepare('INSERT INTO k VALUES(?,?,?,?,?,?)').run(d.id,d.title,'',d.content,grams(d.title+' '+d.content).join(' '),'');}
 search(q,k=10){const expr=query(q);if(!expr)return[];return this.db.prepare('SELECT path AS id,bm25(k,0,6.0,4.0,1.0,1.5) AS score FROM k WHERE k MATCH ? ORDER BY score,path LIMIT ?').all(expr,k);}
 close(){this.db.close();}
}
