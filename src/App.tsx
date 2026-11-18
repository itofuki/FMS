import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { SidebarProvider } from "./contexts/SidebarContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; // 🌟 追加
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"; // 🌟 デバッグ用に推奨（開発時のみ）
import Layout from './components/Layout';
import RootRedirect from "./components/RootRedirect";
import LoginForm from './pages/LoginForm';
import MyPage from "./pages/MyPage";
import { ThemeColorSync } from "./components/ThemeToggle";

// 🌟 1. QueryClient のインスタンスを作成
// ここでアプリ全体のキャッシュの挙動（有効期限など）を一括設定できます
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5分間はデータを「新鮮（staleではない）」とみなし、タブを切り替えても再取得を控える設定
      staleTime: 1000 * 60 * 5, 
      // ウィンドウにフォーカスが戻った時の自動リロードを無効化（好みに合わせて）
      refetchOnWindowFocus: false,
      // 通信失敗時のリトライ回数
      retry: 1,
    },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        // トップの画面はなく、ログイン画面（ログイン済みならマイページ）へすぐ移る
        index: true,
        element: <RootRedirect />,
      },
      {
        path: "login",
        element: <LoginForm />,
      },
      {
        path: "mypage",
        element: <MyPage />,
      },
    ],
  },
]);

export default function App() {
  return (
    // 🌟 2. QueryClientProvider でアプリ全体をラップ
    <QueryClientProvider client={queryClient}>
      <ThemeColorSync />
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
      
      {/* 🌟 3. 開発者ツール（右下にアイコンが出ます。本番ビルドには含まれません）
          キャッシュの中身が丸見えになるので、学習・開発効率が爆上がりします！ */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}