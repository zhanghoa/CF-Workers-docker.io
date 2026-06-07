// _worker.js

let hub_host = 'registry-1.docker.io';
const auth_url = 'https://auth.docker.io';

// --- 完整的搜索页面 HTML/CSS ---
const SEARCH_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Docker Hub 镜像搜索</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root { --github-color: rgb(27,86,198); --primary-color: #0066ff; --gradient-start: #1a90ff; --gradient-end: #003eb3; --text-color: #ffffff; }
        body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%); color: var(--text-color); }
        .container { text-align: center; width: 100%; max-width: 800px; padding: 20px; }
        .search-container { display: flex; width: 100%; max-width: 600px; margin: 20px auto; height: 55px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
        #search-input { flex: 1; padding: 0 20px; border: none; outline: none; font-size: 16px; color: #333; }
        #search-button { width: 60px; background-color: var(--primary-color); border: none; cursor: pointer; color: white; font-weight: bold; }
        .tips { margin-top: 20px; font-size: 0.9em; opacity: 0.8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Docker Hub 镜像搜索</h1>
        <p>快速查找、下载和部署 Docker 容器镜像</p>
        <div class="search-container">
            <input type="text" id="search-input" placeholder="输入关键词，如: nginx, mysql...">
            <button id="search-button">搜索</button>
        </div>
        <p class="tips">基于 Cloudflare Workers 构建</p>
    </div>
    <script>
        function performSearch(){ const query = document.getElementById('search-input').value; if(query) window.location.href = '/search?q=' + encodeURIComponent(query); }
        document.getElementById('search-button').onclick = performSearch;
        document.getElementById('search-input').onkeypress = (e) => { if(e.key === 'Enter') performSearch(); };
    </script>
</body>
</html>
`;

// --- 后端逻辑 ---
export default {
    async fetch(request, env, ctx) {
        let url = new URL(request.url);
        
        // 认证逻辑：优先使用环境变量
        let basicAuthHeader = env.DOCKER_USERNAME && env.DOCKER_PASSWORD ? "Basic " + btoa(`${env.DOCKER_USERNAME}:${env.DOCKER_PASSWORD}`) : "";
        const clientAuth = request.headers.get("Authorization");

        // 路由处理
        if (url.pathname === '/') {
            return new Response(SEARCH_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
        }

        // 处理token请求
        if (url.pathname.includes('/token')) {
            let token_parameter = { headers: { 'Host': 'auth.docker.io', 'Authorization': clientAuth || basicAuthHeader } };
            return fetch(new Request(auth_url + url.pathname + url.search, request), token_parameter);
        }

        // V2 代理逻辑
        url.hostname = hub_host;
        let parameter = { headers: { 'Host': hub_host, 'Authorization': clientAuth || basicAuthHeader } };
        
        // 自动拉取权限注入
        if (url.pathname.startsWith('/v2/') && (url.pathname.includes('/manifests/') || url.pathname.includes('/blobs/') || url.pathname.includes('/tags/'))) {
            let repo = (url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/) || [])[1];
            if (repo && basicAuthHeader && !clientAuth) {
                const tokenRes = await fetch(`${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`, { headers: { 'Authorization': basicAuthHeader } });
                if (tokenRes.ok) {
                    parameter.headers['Authorization'] = 'Bearer ' + (await tokenRes.json()).token;
                }
            }
        }

        return fetch(new Request(url, request), parameter);
    }
};
