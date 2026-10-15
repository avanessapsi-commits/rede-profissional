#!/usr/bin/env python3
"""
Radar da Semana — Busca automática de artigos e recursos na área perinatal.
Busca PubMed + Cochrane Library e salva em JSON estruturado.

Uso: python radar-busca-semanal.py [--semanas 1]
"""

import json
import datetime
import requests
import sys
import time
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

# ═════════════════════════════════════════════════════════════════════════

TERMOS_PUBMED = [
    "perinatal mental health",
    "postpartum depression",
    "pregnancy anxiety",
    "maternal mental health",
    "puerperium AND depression",
]

TERMOS_PT = [
    "saúde mental perinatal",
    "depressão pós-parto",
    "ansiedade na gravidez",
    "psicologia perinatal",
]

EMAIL_NCBI = "avanessapsi@gmail.com"  # NCBI pede email pra usar a API

# ═════════════════════════════════════════════════════════════════════════

class RadarBusca:
    def __init__(self, semanas=1):
        self.semanas = semanas
        self.data_inicio = datetime.datetime.now() - datetime.timedelta(days=7 * semanas)
        self.data_str = self.data_inicio.strftime("%Y/%m/%d")
        self.artigos = []
        self.cochrane = []

    def buscar_pubmed(self):
        """Busca PubMed via E-utilities API"""
        print(f"🔍 Buscando PubMed (últimas {self.semanas} semana(s))...")

        for termo in TERMOS_PUBMED + TERMOS_PT:
            try:
                # 1. esearch: buscar IDs
                # Intervalo de datas (entrada no PubMed de data_str até hoje). Antes era
                # uma data só, e a busca pegava apenas o dia de 7 dias atrás.
                query = f'{termo}[TIAB] AND ("{self.data_str}"[EDAT] : "3000"[EDAT])'
                params = {
                    "db": "pubmed",
                    "term": query,
                    "retmax": "20",
                    "sort": "date",
                    "email": EMAIL_NCBI,
                }
                url_search = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
                # Sem chave, o NCBI aceita até 3 pedidos por segundo; acima disso devolve 429.
                time.sleep(0.5)
                resp = requests.get(url_search, params=params, timeout=10)
                resp.raise_for_status()

                root = ET.fromstring(resp.content)
                ids = [id_elem.text for id_elem in root.findall(".//Id")]

                if not ids:
                    continue

                # 2. efetch: pegar dados completos
                params_fetch = {
                    "db": "pubmed",
                    "id": ",".join(ids),
                    "rettype": "xml",
                    "email": EMAIL_NCBI,
                }
                time.sleep(0.5)
                resp_fetch = requests.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                                        params=params_fetch, timeout=10)
                resp_fetch.raise_for_status()

                root_fetch = ET.fromstring(resp_fetch.content)

                for article in root_fetch.findall(".//PubmedArticle"):
                    dados = self._extrair_pubmed(article)
                    # O mesmo artigo volta por mais de um termo; compara pelo link (PMID).
                    if dados and dados["link"] not in {a["link"] for a in self.artigos}:
                        self.artigos.append(dados)

            except Exception as e:
                print(f"  ⚠️ Erro ao buscar '{termo}': {e}")

        print(f"✅ {len(self.artigos)} artigos encontrados")

    def _extrair_pubmed(self, article):
        """Extrai metadados de um artigo PubMed"""
        try:
            # Título
            title_elem = article.find(".//ArticleTitle")
            titulo = title_elem.text if title_elem is not None else "Sem título"

            # PMID
            pmid = article.find(".//PMID").text

            # Autores
            autores = []
            for author in article.findall(".//Author"):
                nome = author.find("LastName")
                if nome is not None:
                    autores.append(nome.text)
            autor_str = ", ".join(autores[:3]) + ("..." if len(autores) > 3 else "")

            # Data de publicação
            pub_date = article.find(".//PubDate")
            if pub_date is not None:
                year = pub_date.find("Year")
                month = pub_date.find("Month")
                ano = year.text if year is not None else "?"
                mes = month.text if month is not None else ""
                data = f"{mes}/{ano}".strip("/")
            else:
                data = "?"

            # Revista
            journal = article.find(".//Journal/Title")
            revista = journal.text if journal is not None else "?"

            # Resumo
            abstract = article.find(".//AbstractText")
            resumo = abstract.text[:200] + "..." if abstract is not None else "[sem resumo]"

            link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"

            return {
                "titulo": titulo,
                "autor": autor_str,
                "fonte": f"PubMed | {revista}",
                "data": data,
                "resumo": resumo,
                "link": link,
                "tipo": "artigo",
            }
        except Exception as e:
            print(f"  Erro ao extrair artigo: {e}")
            return None

    def buscar_cochrane(self):
        """
        Busca Cochrane Library.
        Nota: Cochrane não tem API pública, então buscamos via RSS ou web scraping.
        Por enquanto, vamos retornar um placeholder com instruções.
        """
        print("🔍 Cochrane Library — buscando...")

        # Cochrane tem RSS? Vamos tentar RSS da Cochrane Reviews
        try:
            # Cochrane Reviews RSS (aproximado)
            rss_url = "https://www.cochranelibrary.com/CD/default.jsp?rss=yes&keywords=perinatal+mental+health"
            resp = requests.get(rss_url, timeout=10)
            resp.raise_for_status()

            root = ET.fromstring(resp.content)
            for item in root.findall(".//item")[:5]:
                titulo_elem = item.find("title")
                link_elem = item.find("link")
                desc_elem = item.find("description")

                if titulo_elem is not None and link_elem is not None:
                    self.cochrane.append({
                        "titulo": titulo_elem.text or "Sem título",
                        "fonte": "Cochrane Library",
                        "resumo": (desc_elem.text or "")[:150],
                        "link": link_elem.text or "",
                        "tipo": "revisao",
                    })
        except Exception as e:
            print(f"  ⚠️ Cochrane RSS não disponível: {e}")
            print("  → Busque manualmente em: https://www.cochranelibrary.com/")

    def salvar_json(self, arquivo="radar-artigos.json"):
        """Salva resultados em JSON"""
        saida = {
            "data_busca": datetime.datetime.now().isoformat(),
            "semanas": self.semanas,
            "artigos_pubmed": self.artigos,
            "revisoes_cochrane": self.cochrane,
        }

        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(saida, f, ensure_ascii=False, indent=2)

        print(f"💾 Salvo em: {arquivo}")
        return arquivo

    def resumo_markdown(self):
        """Gera resumo em Markdown para copiar/colar no template"""
        md = []
        md.append("## 📖 REPERTÓRIO — Pesquisas e Artigos Recentes\n")
        md.append(f"**Busca realizada:** {datetime.datetime.now().strftime('%d/%m/%Y às %H:%M')}\n")

        if self.artigos:
            md.append(f"\n### PubMed ({len(self.artigos)} artigos)\n")
            for a in self.artigos[:5]:  # Top 5
                md.append(f"- **{a['titulo']}**")
                md.append(f"  - {a['autor']} | {a['data']}")
                md.append(f"  - {a['resumo']}")
                md.append(f"  - [{a['link']}]({a['link']})\n")

        if self.cochrane:
            md.append(f"\n### Cochrane Library ({len(self.cochrane)} revisões)\n")
            for c in self.cochrane[:3]:
                md.append(f"- **{c['titulo']}**")
                md.append(f"  - {c['resumo']}")
                md.append(f"  - [{c['link']}]({c['link']})\n")

        return "\n".join(md)

# ═════════════════════════════════════════════════════════════════════════

def main():
    semanas = int(sys.argv[1]) if len(sys.argv) > 1 else 1

    radar = RadarBusca(semanas=semanas)
    radar.buscar_pubmed()
    radar.buscar_cochrane()

    arquivo = radar.salvar_json()
    print("\n" + "=" * 60)
    print(radar.resumo_markdown())
    print("=" * 60)
    print(f"\n💡 Copie e cole o resumo acima no template do Radar da Semana.")

if __name__ == "__main__":
    main()
