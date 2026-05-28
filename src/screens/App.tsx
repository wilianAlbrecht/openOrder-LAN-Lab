export function App() {
  return (
    <main className="app-shell">
      <section className="start-panel" aria-labelledby="app-title">
        <div className="brand">
          <h1 id="app-title">OpenOrder</h1>
          <p>Conexão local para operar em LAN, sem cloud e sem internet.</p>
        </div>

        <div className="actions">
          <button className="primary-action" type="button">
            Abrir Loja
          </button>
          <button className="secondary-action" type="button">
            Conectar a um dispositivo
          </button>
        </div>
      </section>
    </main>
  );
}
