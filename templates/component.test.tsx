/**
 * TEMPLATE-OURO: Teste de componente (Vitest + Testing Library).
 *
 * Copie para o lado do componente: lancamentos-lista.test.tsx
 * Cobre: render basico, estado vazio, e o caminho critico (modal block + acao).
 *
 * Setup esperado em config/vitest.config.ts com environment 'jsdom'.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LancamentosLista } from "./lancamentos-lista";

// Mocka a server action — o teste de componente nao toca no banco.
vi.mock("@/lib/actions/lancamentos", () => ({
  excluir: vi.fn().mockResolvedValue({ id: "1" }),
}));
import { excluir } from "@/lib/actions/lancamentos";

const itemFake = {
  id: "1",
  descricao: "Aluguel",
  valor: "1500.00",
  is_deleted: false,
} as never;

describe("LancamentosLista", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mostra estado vazio quando nao ha itens", () => {
    render(<LancamentosLista itens={[]} podeExcluir />);
    expect(screen.getByText(/nenhum lancamento/i)).toBeInTheDocument();
  });

  it("renderiza os itens recebidos", () => {
    render(<LancamentosLista itens={[itemFake]} podeExcluir />);
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
  });

  it("esconde botao excluir sem permissao (RBAC)", () => {
    render(<LancamentosLista itens={[itemFake]} podeExcluir={false} />);
    expect(screen.queryByRole("button", { name: /excluir/i })).toBeNull();
  });

  it("so confirma exclusao apos liberar o block de 3s", async () => {
    vi.useFakeTimers();
    render(<LancamentosLista itens={[itemFake]} podeExcluir />);

    fireEvent.click(screen.getByRole("button", { name: /excluir/i }));
    const confirmar = screen.getByRole("button", { name: /confirmar/i });

    // bloqueado no inicio
    expect(confirmar).toBeDisabled();

    // avanca 3s -> libera
    vi.advanceTimersByTime(3000);
    await waitFor(() => expect(confirmar).toBeEnabled());

    fireEvent.click(confirmar);
    expect(excluir).toHaveBeenCalledWith("1");
    vi.useRealTimers();
  });
});
