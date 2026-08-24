import os
from datetime import datetime

import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st

st.set_page_config(
    page_title="Mamè & Tessaro | GDO Command Center",
    page_icon="🧀",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    .stApp { background: #f7f9fc; }
    [data-testid="stSidebar"] { background: #17212b; }
    [data-testid="stSidebar"] * { color: #eaf0f6 !important; }
    [data-testid="stMetric"] {
        background: #ffffff;
        border: 1px solid #d9e2ec;
        border-radius: 14px;
        padding: 16px;
        box-shadow: 0 2px 8px rgba(16,42,67,.06);
    }
    [data-testid="stMetricLabel"] { color: #52606d !important; }
    [data-testid="stMetricValue"] { color: #102a43 !important; font-weight: 700; }
    h1, h2, h3 { color: #102a43 !important; }
    .block-container { max-width: 1500px; padding-top: 2rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

DATA_FILE = "gdo_database.csv"
NOTES_FILE = "buyer_desk_notes.csv"
TASKS_FILE = "roadmap_tasks.csv"

DEFAULT_GDO = pd.DataFrame([
    {"Gruppo": "Cadoro", "Referenze Attive": 3, "PdV Coperti": 5, "Potenziale PdV": 5, "Canale": "Magazzino Centrale", "Margine Medio %": 21.5, "Stato": "Ottimale"},
    {"Gruppo": "DAO Conad", "Referenze Attive": 1, "PdV Coperti": 15, "Potenziale PdV": 100, "Canale": "Misto", "Margine Medio %": 19.0, "Stato": "Da Espandere"},
    {"Gruppo": "Coop Alleanza", "Referenze Attive": 13, "PdV Coperti": 13, "Potenziale PdV": 100, "Canale": "Misto (3 Centr. + 10 Dir.)", "Margine Medio %": 17.5, "Stato": "Revisione Margini"},
    {"Gruppo": "ACIL Canguro", "Referenze Attive": 8, "PdV Coperti": 15, "Potenziale PdV": 20, "Canale": "Misto", "Margine Medio %": 16.0, "Stato": "Critico / Prezzi"},
    {"Gruppo": "Gruppo Vega / Spac", "Referenze Attive": 104, "PdV Coperti": 104, "Potenziale PdV": 100, "Canale": "Diretta Super W + Centr.", "Margine Medio %": 22.0, "Stato": "Conflitto Canali"},
    {"Gruppo": "Uniko M' (Guarnier)", "Referenze Attive": 1, "PdV Coperti": 3, "Potenziale PdV": 15, "Canale": "Spot / Esclusiva", "Margine Medio %": 24.0, "Stato": "Opportunità"},
    {"Gruppo": "Ama Crai", "Referenze Attive": 0, "PdV Coperti": 0, "Potenziale PdV": 150, "Canale": "Da Attivare", "Margine Medio %": 0.0, "Stato": "Lead Strategico"},
])

DEFAULT_NOTES = pd.DataFrame([
    {"Gruppo": "Cadoro", "Interlocutore": "Buyer giovane. Ottimo canale fiduciario grazie a Diego Tessaro.", "Piano d'Azione": "Inserimento Montasio, Latteria Sisile e Binate di Agordo per sfruttare il picco autunnale."},
    {"Gruppo": "Coop Alleanza", "Interlocutore": "Buyer senior, prossimo alla pensione; approccio conservativo.", "Piano d'Azione": "Ristrutturare il mix di categoria senza scontro sui prezzi; sbloccare i punti vendita scoperti."},
    {"Gruppo": "DAO Conad", "Interlocutore": "Buyer collaborativo ed esperto.", "Piano d'Azione": "Attivare la rete agenti Tessaro e Madia per ampliare la copertura territoriale."},
    {"Gruppo": "Gruppo Vega / Spac", "Interlocutore": "Doppio buyer, con interlocutori di diversa seniority.", "Piano d'Azione": "Gestire la distinzione tra fornitura diretta a Super W e centralizzazione Vega."},
    {"Gruppo": "Ama Crai", "Interlocutore": "Contatto diretto basato su precedente esperienza commerciale.", "Piano d'Azione": "Proporre un pilota su 20-30 punti vendita con paniere esclusivo Mamè."},
])

DEFAULT_TASKS = pd.DataFrame([
    {"Task": "Sblocco e contatto diretto su Ama Crai", "Completato": True, "Responsabile": "Direzione"},
    {"Task": "Chiusura accordo cross-selling su Cadoro", "Completato": True, "Responsabile": "Diego Tessaro"},
    {"Task": "Briefing agenti Tessaro e Madia per DAO e Vega/Spac", "Completato": False, "Responsabile": "Agenti"},
    {"Task": "Presentazione mix categoria a Coop Alleanza", "Completato": False, "Responsabile": "Direzione"},
    {"Task": "Adeguamento listini ACIL Canguro", "Completato": False, "Responsabile": "Marco Zarpellon"},
])


def load_df(filename, default):
    if os.path.exists(filename):
        try:
            return pd.read_csv(filename)
        except Exception:
            return default.copy()
    return default.copy()


def save_df(df, filename):
    df.to_csv(filename, index=False)


if "gdo_df" not in st.session_state:
    st.session_state.gdo_df = load_df(DATA_FILE, DEFAULT_GDO)
if "notes_df" not in st.session_state:
    st.session_state.notes_df = load_df(NOTES_FILE, DEFAULT_NOTES)

st.sidebar.title("🧀 Mamè & Tessaro")
st.sidebar.caption("GDO Command Center")
st.sidebar.caption(f"Aggiornato: {datetime.now().strftime('%d/%m/%Y %H:%M')}")
menu = st.sidebar.selectbox(
    "Sezione",
    [
        "📊 Executive Dashboard",
        "📥 Importazione dati",
        "🏢 Gruppi GDO & Buyer Desk",
        "📦 SKU & Dynamic Pricing",
        "🎯 Roadmap operativa",
    ],
)

if menu == "📊 Executive Dashboard":
    df = st.session_state.gdo_df.copy()
    st.title("📊 Executive GDO Command Center")
    st.write("Visione integrata di copertura, marginalità, potenziale e priorità commerciali.")

    if df.empty:
        st.warning("Il database è vuoto. Importa un file o aggiungi un gruppo GDO.")
    else:
        df["Copertura %"] = (df["PdV Coperti"] / df["Potenziale PdV"].replace(0, np.nan) * 100).fillna(0).round(1)
        gruppi = len(df)
        margine = round(df["Margine Medio %"].mean(), 1)
        pdv_attivi = int(df["PdV Coperti"].sum())
        pdv_potenziale = int(df["Potenziale PdV"].sum())
        copertura = round(pdv_attivi / pdv_potenziale * 100, 1) if pdv_potenziale else 0

        c1, c2 = st.columns(2)
        c1.metric("Gruppi GDO gestiti", gruppi)
        c2.metric("Margine medio", f"{margine}%")
        c3, c4 = st.columns(2)
        c3.metric("Punti vendita attivi", pdv_attivi, delta=f"Potenziale: {pdv_potenziale}")
        c4.metric("Copertura della rete", f"{copertura}%")

        st.markdown("---")
        critici = df[df["Stato"].str.contains("Critico|Revisione|Conflitto", case=False, na=False)]
        if not critici.empty:
            st.warning("⚠️ Attenzione: " + ", ".join(critici["Gruppo"].tolist()))

        g1, g2 = st.columns(2)
        with g1:
            fig1 = px.bar(
                df.sort_values("Copertura %"), x="Copertura %", y="Gruppo", color="Stato",
                orientation="h", text="Copertura %", title="Copertura commerciale per gruppo",
                template="plotly_white"
            )
            fig1.update_traces(texttemplate="%{text:.1f}%", textposition="outside")
            fig1.update_layout(xaxis_range=[0, max(110, float(df["Copertura %"].max() + 15))], height=430, legend_title_text="Stato")
            st.plotly_chart(fig1, use_container_width=True)
        with g2:
            fig2 = px.scatter(
                df, x="Copertura %", y="Margine Medio %", size="Referenze Attive",
                color="Stato", text="Gruppo", hover_data=["PdV Coperti", "Potenziale PdV"],
                title="Matrice rischio / opportunità", template="plotly_white"
            )
            fig2.update_traces(textposition="top center")
            fig2.update_layout(xaxis_range=[0, 110], height=430, legend_title_text="Stato")
            st.plotly_chart(fig2, use_container_width=True)

        with st.expander("📋 Visualizza tabella completa", expanded=True):
            st.dataframe(df, use_container_width=True, hide_index=True)

elif menu == "📥 Importazione dati":
    st.title("📥 Importazione dati")
    st.write("Carica un file CSV o Excel esportato dal gestionale.")
    uploaded = st.file_uploader("Seleziona file", type=["csv", "xlsx"])
    if uploaded:
        try:
            imported = pd.read_csv(uploaded) if uploaded.name.lower().endswith(".csv") else pd.read_excel(uploaded)
            required = {"Gruppo", "Referenze Attive", "PdV Coperti", "Potenziale PdV", "Canale", "Margine Medio %", "Stato"}
            missing = required - set(imported.columns)
            if missing:
                st.error("Colonne mancanti: " + ", ".join(sorted(missing)))
            else:
                st.success("File validato correttamente.")
                st.dataframe(imported, use_container_width=True, hide_index=True)
                mode = st.radio("Modalità importazione", ["Sostituisci database", "Aggiungi ai dati esistenti"])
                if st.button("💾 Conferma importazione"):
                    st.session_state.gdo_df = imported if mode == "Sostituisci database" else pd.concat([st.session_state.gdo_df, imported], ignore_index=True)
                    save_df(st.session_state.gdo_df, DATA_FILE)
                    st.success("Importazione completata e salvata.")
                    st.rerun()
        except Exception as exc:
            st.error(f"Errore nella lettura del file: {exc}")

elif menu == "🏢 Gruppi GDO & Buyer Desk":
    st.title("🏢 Gruppi GDO & Buyer Desk")
    st.write("Consulta e aggiorna le informazioni commerciali senza modificare il codice.")
    df = st.session_state.gdo_df
    tab1, tab2, tab3 = st.tabs(["Consulta", "Modifica dati", "Nuovo gruppo"])

    with tab1:
        if df.empty:
            st.info("Nessun gruppo presente.")
        else:
            selected = st.selectbox("Gruppo GDO", df["Gruppo"].tolist())
            row = df[df["Gruppo"] == selected].iloc[0]
            note = st.session_state.notes_df[st.session_state.notes_df["Gruppo"] == selected]
            a, b = st.columns([2, 1])
            with a:
                st.subheader(f"Analisi di contatto: {selected}")
                if note.empty:
                    st.info("Nessuna nota registrata.")
                else:
                    st.write(f"**Interlocutore:** {note.iloc[0]['Interlocutore']}")
                    st.write("**Piano d'azione:**")
                    st.write(note.iloc[0]["Piano d'Azione"])
            with b:
                st.metric("Margine", f"{row['Margine Medio %']}%")
                st.metric("PdV coperti", f"{row['PdV Coperti']} / {row['Potenziale PdV']}")
                st.metric("Stato", row["Stato"])

    with tab2:
        edited_data = st.data_editor(df, num_rows="dynamic", use_container_width=True, hide_index=True, key="gdo_editor")
        if st.button("💾 Salva modifiche GDO"):
            st.session_state.gdo_df = edited_data
            save_df(edited_data, DATA_FILE)
            st.success("Modifiche salvate.")
        st.markdown("### Note Buyer Desk")
        edited_notes = st.data_editor(st.session_state.notes_df, num_rows="dynamic", use_container_width=True, hide_index=True, key="notes_editor")
        if st.button("💾 Salva note Buyer Desk"):
            st.session_state.notes_df = edited_notes
            save_df(edited_notes, NOTES_FILE)
            st.success("Note salvate.")

    with tab3:
        with st.form("new_group"):
            name = st.text_input("Nome gruppo GDO")
            refs = st.number_input("Referenze attive", min_value=0, value=0)
            covered = st.number_input("PdV coperti", min_value=0, value=0)
            potential = st.number_input("Potenziale PdV", min_value=0, value=10)
            channel = st.text_input("Canale", value="Da attivare")
            margin = st.number_input("Margine medio %", min_value=0.0, max_value=100.0, value=20.0)
            status = st.selectbox("Stato", ["Ottimale", "Da Espandere", "Revisione Margini", "Critico / Prezzi", "Conflitto Canali", "Opportunità", "Lead Strategico"])
            submit = st.form_submit_button("➕ Aggiungi gruppo")
            if submit:
                if not name.strip():
                    st.error("Inserisci il nome del gruppo.")
                elif name in df["Gruppo"].tolist():
                    st.error("Questo gruppo esiste già.")
                else:
                    new_row = pd.DataFrame([{"Gruppo": name, "Referenze Attive": refs, "PdV Coperti": covered, "Potenziale PdV": potential, "Canale": channel, "Margine Medio %": margin, "Stato": status}])
                    st.session_state.gdo_df = pd.concat([df, new_row], ignore_index=True)
                    save_df(st.session_state.gdo_df, DATA_FILE)
                    st.success("Gruppo aggiunto.")
                    st.rerun()

elif menu == "📦 SKU & Dynamic Pricing":
    st.title("📦 SKU & Dynamic Pricing")
    st.write("Simulatore del prezzo di cessione e del prezzo consigliato a scaffale.")
    a, b = st.columns(2)
    with a:
        cost = st.number_input("Costo industriale prodotto (€)", min_value=0.01, value=5.00, step=0.25)
        margin_company = st.slider("Margine obiettivo azienda (%)", 15, 30, 21)
    with b:
        margin_store = st.slider("Margine obiettivo punto vendita (%)", 25, 45, 35)
    transfer = cost / (1 - margin_company / 100)
    shelf = transfer / (1 - margin_store / 100)
    r1, r2, r3 = st.columns(3)
    r1.metric("Prezzo cessione GDO", f"€ {transfer:.2f}")
    r2.metric("Prezzo consigliato scaffale", f"€ {shelf:.2f}")
    r3.metric("Differenza lorda punto vendita", f"€ {shelf - transfer:.2f}")
    levels = np.arange(25, 46)
    sensitivity = pd.DataFrame({"Margine punto vendita %": levels, "Prezzo scaffale €": [transfer / (1 - x / 100) for x in levels]})
    st.plotly_chart(px.line(sensitivity, x="Margine punto vendita %", y="Prezzo scaffale €", markers=True, template="plotly_white"), use_container_width=True)

elif menu == "🎯 Roadmap operativa":
    st.title("🎯 Roadmap operativa")
    st.write("Attività commerciali persistenti, assegnabili e modificabili.")
    tasks = load_df(TASKS_FILE, DEFAULT_TASKS)
    edited_tasks = st.data_editor(tasks, column_config={"Completato": st.column_config.CheckboxColumn("Completato")}, num_rows="dynamic", use_container_width=True, hide_index=True, key="tasks_editor")
    completed = int(edited_tasks["Completato"].sum()) if len(edited_tasks) else 0
    st.progress(completed / len(edited_tasks) if len(edited_tasks) else 0)
    st.caption(f"{completed} di {len(edited_tasks)} attività completate")
    if st.button("💾 Salva roadmap"):
        save_df(edited_tasks, TASKS_FILE)
        st.success("Roadmap salvata.")
