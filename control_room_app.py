import os
from datetime import date, datetime

import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st
from supabase import Client, create_client

st.set_page_config(
    page_title="Mamè & Tessaro | GDO Command Center",
    page_icon="🧀",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
.stApp { background: #f7f9fc; }
[data-testid="stSidebar"] { background: #17212b; }
[data-testid="stSidebar"] * { color: #eaf0f6 !important; }
[data-testid="stMetric"] { background:#fff; border:1px solid #d9e2ec; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(16,42,67,.06); }
[data-testid="stMetricLabel"] { color:#52606d !important; }
[data-testid="stMetricValue"] { color:#102a43 !important; font-weight:700; }
h1,h2,h3 { color:#102a43 !important; }
.block-container { max-width:1500px; padding-top:2rem; }
</style>
""", unsafe_allow_html=True)

REQUIRED_SECRETS = ("SUPABASE_URL", "SUPABASE_KEY")


def get_client() -> Client:
    missing = [key for key in REQUIRED_SECRETS if not st.secrets.get(key)]
    if missing:
        st.error("Configurazione incompleta: mancano i secrets " + ", ".join(missing) + ".")
        st.stop()
    return create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"])


supabase = get_client()

DEFAULT_GDO = pd.DataFrame([
    {"gruppo":"Cadoro", "referenze_attive":3, "pdv_coperti":5, "potenziale_pdv":5, "canale":"Magazzino Centrale", "margine_medio":21.5, "stato":"Ottimale"},
    {"gruppo":"DAO Conad", "referenze_attive":1, "pdv_coperti":15, "potenziale_pdv":100, "canale":"Misto", "margine_medio":19.0, "stato":"Da Espandere"},
    {"gruppo":"Coop Alleanza", "referenze_attive":13, "pdv_coperti":13, "potenziale_pdv":100, "canale":"Misto (3 Centr. + 10 Dir.)", "margine_medio":17.5, "stato":"Revisione Margini"},
    {"gruppo":"ACIL Canguro", "referenze_attive":8, "pdv_coperti":15, "potenziale_pdv":20, "canale":"Misto", "margine_medio":16.0, "stato":"Critico / Prezzi"},
    {"gruppo":"Gruppo Vega / Spac", "referenze_attive":104, "pdv_coperti":104, "potenziale_pdv":100, "canale":"Diretta Super W + Centr.", "margine_medio":22.0, "stato":"Conflitto Canali"},
    {"gruppo":"Uniko M' (Guarnier)", "referenze_attive":1, "pdv_coperti":3, "potenziale_pdv":15, "canale":"Spot / Esclusiva", "margine_medio":24.0, "stato":"Opportunità"},
    {"gruppo":"Ama Crai", "referenze_attive":0, "pdv_coperti":0, "potenziale_pdv":150, "canale":"Da Attivare", "margine_medio":0.0, "stato":"Lead Strategico"},
])

DEFAULT_NOTES = {
    "Cadoro": ("Buyer giovane. Ottimo canale fiduciario grazie a Diego Tessaro.", "Inserimento Montasio, Latteria Sisile e Binate di Agordo per sfruttare il picco autunnale."),
    "Coop Alleanza": ("Buyer senior, prossimo alla pensione; approccio conservativo.", "Ristrutturare il mix di categoria senza scontro sui prezzi; sbloccare i punti vendita scoperti."),
    "DAO Conad": ("Buyer collaborativo ed esperto.", "Attivare la rete agenti Tessaro e Madia per ampliare la copertura territoriale."),
    "Gruppo Vega / Spac": ("Doppio buyer, con interlocutori di diversa seniority.", "Gestire la distinzione tra fornitura diretta a Super W e centralizzazione Vega."),
    "Ama Crai": ("Contatto diretto basato su precedente esperienza commerciale.", "Proporre un pilota su 20-30 punti vendita con paniere esclusivo Mamè."),
}

DEFAULT_TASKS = pd.DataFrame([
    {"task":"Sblocco e contatto diretto su Ama Crai", "completato":True, "responsabile":"Direzione", "priorita":"Alta", "scadenza":None},
    {"task":"Chiusura accordo cross-selling su Cadoro", "completato":True, "responsabile":"Diego Tessaro", "priorita":"Alta", "scadenza":None},
    {"task":"Briefing agenti Tessaro e Madia per DAO e Vega/Spac", "completato":False, "responsabile":"Agenti", "priorita":"Alta", "scadenza":None},
    {"task":"Presentazione mix categoria a Coop Alleanza", "completato":False, "responsabile":"Direzione", "priorita":"Normale", "scadenza":None},
    {"task":"Adeguamento listini ACIL Canguro", "completato":False, "responsabile":"Marco Zarpellon", "priorita":"Alta", "scadenza":None},
])


def read_table(table: str) -> pd.DataFrame:
    result = supabase.table(table).select("*").execute()
    return pd.DataFrame(result.data or [])


def audit(table_name, record_id, action, old_data=None, new_data=None):
    try:
        user = supabase.auth.get_user()
        user_id = user.user.id if user and user.user else None
    except Exception:
        user_id = None
    supabase.table("audit_log").insert({"user_id": user_id, "table_name": table_name, "record_id": record_id, "action": action, "old_data": old_data, "new_data": new_data}).execute()


def login():
    st.title("🧀 Mamè & Tessaro GDO Command Center")
    st.subheader("Accesso riservato")
    with st.form("login_form"):
        email = st.text_input("Email")
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Accedi")
    if submitted:
        try:
            supabase.auth.sign_in_with_password({"email": email, "password": password})
            st.rerun()
        except Exception:
            st.error("Email o password non valide.")


try:
    session = supabase.auth.get_session()
except Exception:
    session = None

if not session or not session.user:
    login()
    st.stop()

st.sidebar.title("🧀 Mamè & Tessaro")
st.sidebar.caption("GDO Command Center")
st.sidebar.caption(f"Utente: {session.user.email}")
if st.sidebar.button("Esci"):
    supabase.auth.sign_out()
    st.rerun()

menu = st.sidebar.selectbox("Sezione", ["📊 Executive Dashboard", "📥 Importazione dati", "🏢 Gruppi GDO & Buyer Desk", "📦 SKU & Dynamic Pricing", "🎯 Roadmap operativa"])

if menu == "📊 Executive Dashboard":
    st.title("📊 Executive GDO Command Center")
    st.write("Dati letti direttamente da Supabase.")
    df = read_table("gdo_groups")
    if df.empty:
        st.warning("Il database è vuoto. Vai in Importazione dati oppure aggiungi un gruppo dal Buyer Desk.")
    else:
        df["Copertura %"] = (df["pdv_coperti"] / df["potenziale_pdv"].replace(0, np.nan) * 100).fillna(0).round(1)
        c1, c2 = st.columns(2)
        c1.metric("Gruppi GDO gestiti", len(df))
        c2.metric("Margine medio", f"{df['margine_medio'].mean():.1f}%")
        c3, c4 = st.columns(2)
        c3.metric("Punti vendita attivi", int(df["pdv_coperti"].sum()))
        total = int(df["potenziale_pdv"].sum())
        c4.metric("Copertura della rete", f"{(df['pdv_coperti'].sum()/total*100 if total else 0):.1f}%")
        attention = df[df["stato"].str.contains("Critico|Revisione|Conflitto", case=False, na=False)]
        if not attention.empty:
            st.warning("⚠️ Attenzione: " + ", ".join(attention["gruppo"].tolist()))
        a, b = st.columns(2)
        with a:
            fig = px.bar(df.sort_values("Copertura %"), x="Copertura %", y="gruppo", color="stato", orientation="h", text="Copertura %", title="Copertura commerciale per gruppo", template="plotly_white")
            fig.update_traces(texttemplate="%{text:.1f}%", textposition="outside")
            fig.update_layout(xaxis_range=[0, max(110, float(df["Copertura %"].max()+15))], height=430)
            st.plotly_chart(fig, use_container_width=True)
        with b:
            fig = px.scatter(df, x="Copertura %", y="margine_medio", size="referenze_attive", color="stato", text="gruppo", title="Matrice rischio / opportunità", template="plotly_white")
            fig.update_traces(textposition="top center")
            fig.update_layout(xaxis_range=[0, 110], height=430)
            st.plotly_chart(fig, use_container_width=True)
        with st.expander("📋 Tabella completa", expanded=True):
            st.dataframe(df, use_container_width=True, hide_index=True)

elif menu == "📥 Importazione dati":
    st.title("📥 Importazione dati")
    uploaded = st.file_uploader("Carica CSV o Excel", type=["csv", "xlsx"])
    if uploaded:
        try:
            imported = pd.read_csv(uploaded) if uploaded.name.lower().endswith(".csv") else pd.read_excel(uploaded)
            old_names = {"Gruppo":"gruppo", "Referenze Attive":"referenze_attive", "PdV Coperti":"pdv_coperti", "Potenziale PdV":"potenziale_pdv", "Canale":"canale", "Margine Medio %":"margine_medio", "Stato":"stato"}
            imported = imported.rename(columns=old_names)
            required = {"gruppo", "referenze_attive", "pdv_coperti", "potenziale_pdv", "canale", "margine_medio", "stato"}
            missing = required - set(imported.columns)
            if missing:
                st.error("Colonne mancanti: " + ", ".join(sorted(missing)))
            else:
                st.dataframe(imported, use_container_width=True, hide_index=True)
                if st.button("💾 Importa nel database"):
                    rows = imported[list(required)].replace({np.nan: None}).to_dict(orient="records")
                    for row in rows:
                        existing = supabase.table("gdo_groups").select("id").eq("gruppo", row["gruppo"]).execute().data
                        if existing:
                            record_id = existing[0]["id"]
                            supabase.table("gdo_groups").update(row).eq("id", record_id).execute()
                            audit("gdo_groups", record_id, "UPDATE", new_data=row)
                        else:
                            inserted = supabase.table("gdo_groups").insert(row).execute().data
                            if inserted:
                                audit("gdo_groups", inserted[0]["id"], "INSERT", new_data=row)
                    st.success("Importazione completata su Supabase.")
                    st.rerun()
        except Exception as exc:
            st.error(f"Errore nella lettura del file: {exc}")

elif menu == "🏢 Gruppi GDO & Buyer Desk":
    st.title("🏢 Gruppi GDO & Buyer Desk")
    df = read_table("gdo_groups")
    tab1, tab2, tab3 = st.tabs(["Consulta", "Modifica dati", "Nuovo gruppo"])
    with tab1:
        if df.empty:
            st.info("Nessun gruppo presente.")
        else:
            selected = st.selectbox("Gruppo GDO", df["gruppo"].tolist())
            row = df[df["gruppo"] == selected].iloc[0]
            notes = read_table("buyer_notes")
            note = notes[notes["gruppo_id"] == row["id"]] if not notes.empty else pd.DataFrame()
            a, b = st.columns([2, 1])
            with a:
                st.subheader(f"Analisi di contatto: {selected}")
                if note.empty:
                    default_note = DEFAULT_NOTES.get(selected, ("", ""))
                    st.write(f"**Interlocutore:** {default_note[0]}")
                    st.write("**Piano d'azione:**")
                    st.write(default_note[1])
                else:
                    st.write(f"**Interlocutore:** {note.iloc[0]['interlocutore']}")
                    st.write("**Piano d'azione:**")
                    st.write(note.iloc[0]["piano_azione"])
            with b:
                st.metric("Margine", f"{row['margine_medio']}%")
                st.metric("PdV coperti", f"{row['pdv_coperti']} / {row['potenziale_pdv']}")
                st.metric("Stato", row["stato"])
    with tab2:
        if df.empty:
            st.info("Nessun dato da modificare.")
        else:
            display = df.rename(columns={"gruppo":"Gruppo", "referenze_attive":"Referenze attive", "pdv_coperti":"PdV coperti", "potenziale_pdv":"Potenziale PdV", "canale":"Canale", "margine_medio":"Margine medio", "stato":"Stato"})
            edited = st.data_editor(display, use_container_width=True, hide_index=True, key="gdo_editor")
            if st.button("💾 Salva modifiche GDO"):
                for _, item in edited.iterrows():
                    record_id = int(df.loc[df["gruppo"] == item["Gruppo"], "id"].iloc[0])
                    row = {"gruppo": item["Gruppo"], "referenze_attive": int(item["Referenze attive"]), "pdv_coperti": int(item["PdV coperti"]), "potenziale_pdv": int(item["Potenziale PdV"]), "canale": item["Canale"], "margine_medio": float(item["Margine medio"]), "stato": item["Stato"], "updated_at": datetime.utcnow().isoformat()}
                    supabase.table("gdo_groups").update(row).eq("id", record_id).execute()
                    audit("gdo_groups", record_id, "UPDATE", new_data=row)
                st.success("Modifiche salvate su Supabase.")
                st.rerun()
            st.markdown("### Note Buyer Desk")
            notes = read_table("buyer_notes")
            if not notes.empty:
                st.dataframe(notes, use_container_width=True, hide_index=True)
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
                try:
                    inserted = supabase.table("gdo_groups").insert({"gruppo":name, "referenze_attive":refs, "pdv_coperti":covered, "potenziale_pdv":potential, "canale":channel, "margine_medio":margin, "stato":status}).execute().data
                    if inserted:
                        audit("gdo_groups", inserted[0]["id"], "INSERT", new_data=inserted[0])
                    st.success("Gruppo aggiunto su Supabase.")
                    st.rerun()
                except Exception as exc:
                    st.error(f"Impossibile aggiungere il gruppo: {exc}")

elif menu == "📦 SKU & Dynamic Pricing":
    st.title("📦 SKU & Dynamic Pricing")
    a, b = st.columns(2)
    with a:
        cost = st.number_input("Costo industriale prodotto (€)", min_value=0.01, value=5.00, step=0.25)
        margin_company = st.slider("Margine obiettivo azienda (%)", 15, 30, 21)
    with b:
        margin_store = st.slider("Margine obiettivo punto vendita (%)", 25, 45, 35)
    transfer = cost / (1 - margin_company / 100)
    shelf = transfer / (1 - margin_store / 100)
    c1, c2, c3 = st.columns(3)
    c1.metric("Prezzo cessione GDO", f"€ {transfer:.2f}")
    c2.metric("Prezzo consigliato scaffale", f"€ {shelf:.2f}")
    c3.metric("Differenza lorda punto vendita", f"€ {shelf-transfer:.2f}")
    levels = np.arange(25, 46)
    sensitivity = pd.DataFrame({"Margine punto vendita %":levels, "Prezzo scaffale €":[transfer/(1-x/100) for x in levels]})
    st.plotly_chart(px.line(sensitivity, x="Margine punto vendita %", y="Prezzo scaffale €", markers=True, template="plotly_white"), use_container_width=True)

elif menu == "🎯 Roadmap operativa":
    st.title("🎯 Roadmap operativa")
    tasks = read_table("roadmap_tasks")
    if tasks.empty:
        tasks = DEFAULT_TASKS.copy()
        if st.button("Inizializza roadmap su Supabase"):
            for item in tasks.to_dict(orient="records"):
                supabase.table("roadmap_tasks").insert(item).execute()
            st.success("Roadmap inizializzata.")
            st.rerun()
    edited = st.data_editor(tasks, column_config={"completato": st.column_config.CheckboxColumn("Completato")}, use_container_width=True, hide_index=True, num_rows="dynamic", key="task_editor")
    done = int(edited["completato"].sum()) if not edited.empty else 0
    st.progress(done / len(edited) if len(edited) else 0)
    st.caption(f"{done} di {len(edited)} attività completate")
    if st.button("💾 Salva roadmap"):
        for _, item in edited.iterrows():
            if pd.notna(item.get("id")):
                record_id = int(item["id"])
                payload = {"task":item["task"], "completato":bool(item["completato"]), "responsabile":item["responsabile"], "priorita":item["priorita"], "scadenza":None if pd.isna(item.get("scadenza")) else str(item["scadenza"]), "updated_at":datetime.utcnow().isoformat()}
                supabase.table("roadmap_tasks").update(payload).eq("id", record_id).execute()
                audit("roadmap_tasks", record_id, "UPDATE", new_data=payload)
        st.success("Roadmap salvata su Supabase.")
        st.rerun()
