// _worker.js

// Docker镜像仓库主机地址
let hub_host = 'registry-1.docker.io';
// Docker认证服务器地址
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

// 根据主机名选择对应的上游地址
function routeByHosts(host) {
	const routes = {
		"quay": "quay.io", "gcr": "gcr.io", "k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io", "ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io", "nvcr": "nvcr.io",
		"test": "registry-1.docker.io",
	};
	if (host in routes) return [routes[host], false];
	else return [hub_host, true];
}

/** @type {RequestInit} */
const PREFLIGHT_INIT = {
	headers: new Headers({
		'access-control-allow-origin': '*', 
		'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS', 
		'access-control-max-age': '1728000', 
	}),
}

function makeRes(body, status = 200, headers = {}) {
	headers['access-control-allow-origin'] = '*' 
	return new Response(body, { status, headers }) 
}

function newUrl(urlStr, base) {
	try { return new URL(urlStr, base); } 
    catch (err) { return null }
}

async function nginx() {
	return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>`;
}

async function searchInterface() {
	const html = `<!DOCTYPE html><html><head><title>Docker Hub 镜像搜索</title><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
    :root { --github-color: rgb(27,86,198); --primary-color: #0066ff; --gradient-start: #1a90ff; --gradient-end: #003eb3; --text-color: #ffffff; }
    body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, var(--gradient-start) 0%, var(--gradient-end) 100%); color: var(--text-color); }
    .container { text-align: center; width: 100%; max-width: 800px; padding: 20px; }
    .search-container { display: flex; width: 100%; max-width: 600px; margin: 20px auto; height: 55px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
    #search-input { flex: 1; padding: 0 20px; border: none; outline: none; }
    #search-button { width: 60px; background-color: var(--primary-color); border: none; cursor: pointer; }
    </style></head><body><div class="container"><h1>Docker Hub 镜像搜索</h1><div class="search-container"><input type="text" id="search-input" placeholder="输入关键词..."><button id="search-button">GO</button></div></div>
    <script>function performSearch(){const query=document.getElementById('search-input').value;if(query)window.location.href='/search?q='+encodeURIComponent(query);}document.getElementById('search-button').onclick=performSearch;</script></body></html>`;
	return html;
}

export default {
	async fetch(request, env, ctx) {
		const getReqHeader = (key) => request.headers.get(key); 
		let url = new URL(request.url); 
		const userAgent = (getReqHeader('User-Agent') || "").toLowerCase();
		if (env.UA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(env.UA));
        
		// 认证逻辑：优先使用环境变量
		let basicAuthHeader = env.DOCKER_USERNAME && env.DOCKER_PASSWORD ? "Basic " + btoa(`${env.DOCKER_USERNAME}:${env.DOCKER_PASSWORD}`) : "";
		const clientAuth = getReqHeader("Authorization");

		const ns = url.searchParams.get('ns');
		const hostname = url.searchParams.get('hubhost') || url.hostname;
		const hostTop = hostname.split('.')[0]; 
		let checkHost = ns ? [ns === 'docker.io' ? 'registry-1.docker.io' : ns, false] : routeByHosts(hostTop);
		hub_host = checkHost[0];
		const fakePage = checkHost[1]; 
		url.hostname = hub_host;

		if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk))) return new Response(await nginx());
		
        if ((userAgent.includes('mozilla')) || ['/v1/search', '/v1/repositories'].some(p => url.pathname.includes(p))) {
			if (url.pathname == '/') return fakePage ? new Response(await searchInterface(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }) : fetch(new Request(url, request));
            if (url.pathname.startsWith('/v1/')) url.hostname = 'index.docker.io';
			return fetch(new Request(url, request));
		}

		if (url.pathname.includes('/token')) {
			let token_parameter = { headers: { 'Host': 'auth.docker.io', 'Authorization': clientAuth || basicAuthHeader } };
			return fetch(new Request(auth_url + url.pathname + url.search, request), token_parameter);
		}

		if (url.pathname.startsWith('/v2/') && (url.pathname.includes('/manifests/') || url.pathname.includes('/blobs/') || url.pathname.includes('/tags/'))) {
			let repo = (url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/) || [])[1];
			if (repo) {
				const tokenRes = await fetch(`${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`, { headers: basicAuthHeader ? { 'Authorization': basicAuthHeader } : {} });
				let token = tokenRes.ok ? (await tokenRes.json()).token : "";
				let parameter = { headers: { 'Host': hub_host, 'Authorization': token ? `Bearer ${token}` : clientAuth } };
				return fetch(new Request(url, request), parameter);
			}
		}

		let parameter = { headers: { 'Host': hub_host, 'Authorization': clientAuth || basicAuthHeader } };
		return fetch(new Request(url, request), parameter);
	}
};

async function ADD(envadd) { return envadd.replace(/[ |"'\r\n]+/g, ',').split(','); }
