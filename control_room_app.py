import os
from datetime import datetime

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
.stApp { background:#f7f9fc; }
[data-testid="stSidebar"] { background:#17212b; }
[data-testid="stSidebar"] * { color:#eaf0f6 !important; }
[data-testid="stMetric"] { background:#fff; border:1px solid #d9e2ec; border-radius:14px; padding:16px; box-shadow:0 2px 8px rgba(16,42,67,.06); }
[data-testid="stMetricLabel"] { color:#52606d !important; }
[data-testid="stMetricValue"] { color:#102a43 !important; font-weight:700; }
h1,h2,h3 { color:#102a43 !important; }
.block-container { max-width:1500px; padding-top:2rem; }
</style>
""", unsafe_allow_html=True)


def get_supabase() -> Client:
    url = st.secrets.get("SUPABASE_URL")
    key = st.secrets.get("SUPABASE_KEY")
    if not url or not key:
        st.error("Mancano SUPABASE_URL o SUPABASE_KEY nei Secrets di Streamlit Cloud.")
        st.stop()
    return create_client(url, key)


supabase = get_supabase()


def current_session():
    saved = st.session_state.get("supabase_session")
    if saved is not None:
        return saved
    try:
        return supabase.auth.get_session()
    except Exception:
        return None


def login_page():
    st.title("🧀 Mamè & Tessaro GDO Command Center")
    st.subheader("Accesso riservato")
    with st.form("login_form", clear_on_submit=False):
        email = st.text_input("Email", value="tome.johnny@gmail.com")
        password = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Accedi", type="primary")
    if submitted:
        if not email.strip() or not password:
            st.error("Inserisci email e password.")
            return
        try:
            response = supabase.auth.sign_in_with_password({"email": email.strip(), "password": password})
            session = getattr(response, "session", None)
            user = getattr(response, "user", None)
            if session is None and isinstance(response, dict):
                session = response.get("session")
                user = response.get("user")
            if session is None or user is None:
                st.error("Login non completato: Supabase non ha restituito una sessione valida.")
                return
            st.session_state["supabase_session"] = session
            st.session_state["supabase_user"] = user
            st.success("Accesso riuscito. Caricamento della dashboard...")
            st.rerun()
        except Exception:
            st.error("Email o password non valide.")


session = current_session()
if session is None:
    login_page()
    st.stop()

user = st.session_state.get("supabase_user")
if user is None:
    user = getattr(session, "user", None)
    if user is None and isinstance(session, dict):
        user = session.get("user")

st.sidebar.title("🧀 Mamè & Tessaro")
st.sidebar.caption("GDO Command Center")
if user:
    user_email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else "utente")
    st.sidebar.caption(f"Utente: {user_email}")
if st.sidebar.button("Esci"):
    try:
        supabase.auth.sign_out()
    finally:
        st.session_state.pop("supabase_session", None)
        st.session_state.pop("supabase_user", None)
        st.rerun()


def read_table(table):
    result = supabase.table(table).select("*").execute()
    return pd.DataFrame(result.data or [])


def write_audit(table_name, record_id, action, new_data=None, old_data=None):
    try:
        user_id = getattr(user, "id", None) if user else None
        supabase.table("audit_log").insert({
            "user_id": user_id,
            "table_name": table_name,
            "record_id": record_id,
            "action": action,
            "old_data": old_data,
            "new_data": new_data,
        }).execute()
    except Exception:
        pass


menu = st.sidebar.selectbox("Sezione", [
    "📊 Executive Dashboard",
    "📥 Importazione dati",
    "🏢 Gruppi GDO & Buyer Desk",
    "📦 SKU & Dynamic Pricing",
    "🎯 Roadmap operativa",
])

if menu == "📊 Executive Dashboard":
    st.title("📊 Executive GDO Command Center")
    st.write("Dati letti direttamente da Supabase.")
    df = read_table("gdo_groups")
    if df.empty:
        st.warning("Il database è vuoto. Usa Importazione dati per caricare i gruppi GDO.")
    else:
        df["Copertura %"] = (df["pdv_coperti"] / df["potenziale_pdv"].replace(0, np.nan) * 100).fillna(0).round(1)
        total_potential = int(df["potenziale_pdv"].sum())
        c1, c2 = st.columns(2)
        c1.metric("Gruppi GDO gestiti", len(df))
        c2.metric("Margine medio", f"{df['margine_medio'].mean():.1f}%")
        c3, c4 = st.columns(2)
        c3.metric("Punti vendita attivi", int(df["pdv_coperti"].sum()))
        c4.metric("Copertura della rete", f"{(df['pdv_coperti'].sum()/total_potential*100 if total_potential else 0):.1f}%")
        attention = df[df["stato"].str.contains("Critico|Revisione|Conflitto", case=False, na=False)]
        if not attention.empty:
            st.warning("⚠️ Attenzione: " + ", ".join(attention["gruppo"].tolist()))
        a, b = st.columns(2)
        with a:
            fig = px.bar(df.sort_values("Copertura %"), x="Copertura %", y="gruppo", color="stato", orientation="h", text="Copertura %", title="Copertura commerciale per gruppo", template="plotly_white")
            fig.update_traces(texttemplate="%{text:.1f}%", textposition="outside")
            fig.update_layout(xaxis_range=[0, max(110, float(df["Copertura %"].max() + 15))], height=430)
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
            rename = {"Gruppo":"gruppo", "Referenze Attive":"referenze_attive", "PdV Coperti":"pdv_coperti", "Potenziale PdV":"potenziale_pdv", "Canale":"canale", "Margine Medio %":"margine_medio", "Stato":"stato"}
            imported = imported.rename(columns=rename)
            required = ["gruppo", "referenze_attive", "pdv_coperti", "potenziale_pdv", "canale", "margine_medio", "stato"]
            missing = [col for col in required if col not in imported.columns]
            if missing:
                st.error("Colonne mancanti: " + ", ".join(missing))
            else:
                st.dataframe(imported[required], use_container_width=True, hide_index=True)
                if st.button("💾 Importa nel database"):
                    for row in imported[required].replace({np.nan: None}).to_dict(orient="records"):
                        found = supabase.table("gdo_groups").select("id").eq("gruppo", row["gruppo"]).execute().data
                        if found:
                            record_id = found[0]["id"]
                            supabase.table("gdo_groups").update(row).eq("id", record_id).execute()
                            write_audit("gdo_groups", record_id, "UPDATE", new_data=row)
                        else:
                            inserted = supabase.table("gdo_groups").insert(row).execute().data
                            if inserted:
                                write_audit("gdo_groups", inserted[0]["id"], "INSERT", new_data=row)
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
                    st.info("Nessuna nota salvata per questo gruppo.")
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
                    payload = {"gruppo": item["Gruppo"], "referenze_attive": int(item["Referenze attive"]), "pdv_coperti": int(item["PdV coperti"]), "potenziale_pdv": int(item["Potenziale PdV"]), "canale": item["Canale"], "margine_medio": float(item["Margine medio"]), "stato": item["Stato"], "updated_at": datetime.utcnow().isoformat()}
                    supabase.table("gdo_groups").update(payload).eq("id", record_id).execute()
                    write_audit("gdo_groups", record_id, "UPDATE", new_data=payload)
                st.success("Modifiche salvate su Supabase.")
                st.rerun()
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
                else:
                    try:
                        inserted = supabase.table("gdo_groups").insert({"gruppo":name.strip(), "referenze_attive":refs, "pdv_coperti":covered, "potenziale_pdv":potential, "canale":channel, "margine_medio":margin, "stato":status}).execute().data
                        if inserted:
                            write_audit("gdo_groups", inserted[0]["id"], "INSERT", new_data=inserted[0])
                        st.success("Gruppo aggiunto su Supabase.")
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Impossibile aggiungere il gruppo: {exc}")

elif menu == "📦 SKU & Dynamic Pricing":
    st.title("📦 SKU & Dynamic Pricing")
    a, b = st.columns(2)
    with a:
        cost = st.number_input("Costo industriale prodotto (€)", min_value=0.01, value=5.00, step=0.25)
        company_margin = st.slider("Margine obiettivo azienda (%)", 15, 30, 21)
    with b:
        store_margin = st.slider("Margine obiettivo punto vendita (%)", 25, 45, 35)
    transfer = cost / (1 - company_margin / 100)
    shelf = transfer / (1 - store_margin / 100)
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
        st.info("La roadmap è vuota.")
        if st.button("Inizializza roadmap predefinita"):
            defaults = [
                {"task":"Sblocco e contatto diretto su Ama Crai", "completato":True, "responsabile":"Direzione", "priorita":"Alta"},
                {"task":"Chiusura accordo cross-selling su Cadoro", "completato":True, "responsabile":"Diego Tessaro", "priorita":"Alta"},
                {"task":"Briefing agenti Tessaro e Madia per DAO e Vega/Spac", "completato":False, "responsabile":"Agenti", "priorita":"Alta"},
                {"task":"Presentazione mix categoria a Coop Alleanza", "completato":False, "responsabile":"Direzione", "priorita":"Normale"},
                {"task":"Adeguamento listini ACIL Canguro", "completato":False, "responsabile":"Marco Zarpellon", "priorita":"Alta"},
            ]
            for item in defaults:
                supabase.table("roadmap_tasks").insert(item).execute()
            st.success("Roadmap inizializzata.")
            st.rerun()
    else:
        editable = tasks.drop(columns=["created_at", "updated_at"], errors="ignore")
        edited = st.data_editor(editable, column_config={"completato": st.column_config.CheckboxColumn("Completato")}, use_container_width=True, hide_index=True, key="task_editor")
        done = int(edited["completato"].sum()) if not edited.empty else 0
        st.progress(done / len(edited) if len(edited) else 0)
        st.caption(f"{done} di {len(edited)} attività completate")
        if st.button("💾 Salva roadmap"):
            for _, item in edited.iterrows():
                record_id = int(item["id"])
                payload = {"task":item["task"], "completato":bool(item["completato"]), "responsabile":item["responsabile"], "priorita":item["priorita"], "scadenza":None if pd.isna(item.get("scadenza")) else str(item["scadenza"]), "updated_at":datetime.utcnow().isoformat()}
                supabase.table("roadmap_tasks").update(payload).eq("id", record_id).execute()
                write_audit("roadmap_tasks", record_id, "UPDATE", new_data=payload)
            st.success("Roadmap salvata su Supabase.")
            st.rerun()
