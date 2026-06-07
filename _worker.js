// _worker.js

// Docker镜像仓库主机地址
let hub_host = 'registry-1.docker.io';
// Docker认证服务器地址
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

// 根据主机名选择对应的上游地址
function routeByHosts(host) {
	const routes = {
		"quay": "quay.io",
		"gcr": "gcr.io",
		"k8s-gcr": "k8s.gcr.io",
		"k8s": "registry.k8s.io",
		"ghcr": "ghcr.io",
		"cloudsmith": "docker.cloudsmith.io",
		"nvcr": "nvcr.io",
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
	try {
		return new URL(urlStr, base);
	} catch (err) {
		console.error(err);
		return null
	}
}

async function nginx() {
	return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body {width: 35em;margin: 0 auto;font-family: Tahoma, Verdana, Arial, sans-serif;}</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working.</p></body></html>`;
}

async function searchInterface() {
    // ⚠️ 注意：为了不刷屏，这里省略了你原本超长的 HTML 页面代码。
    // 请把你原本代码中 const html = `<!DOCTYPE html>...` 到 `return html;` 的完整搜索页面代码粘贴回这里。
    const html = `<!DOCTYPE html><html><body><h1>Docker Hub 镜像搜索 API 运行中</h1></body></html>`;
    return html;
}

export default {
	async fetch(request, env, ctx) {
		const getReqHeader = (key) => request.headers.get(key); 

		let url = new URL(request.url); 
		const userAgentHeader = request.headers.get('User-Agent');
		const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
		if (env.UA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(env.UA));
		const workers_url = `https://${url.hostname}`;

		// ========== [核心优化 1]：认证信息提取与处理 ==========
		let basicAuthHeader = "";
		if (env.DOCKER_USERNAME && env.DOCKER_PASSWORD) {
			// 将环境变量转换为 Basic Auth 格式
			basicAuthHeader = "Basic " + btoa(`${env.DOCKER_USERNAME}:${env.DOCKER_PASSWORD}`);
		}
		// 提取客户端可能自带的认证头（如终端执行了 docker login）
		const clientAuth = getReqHeader("Authorization");
		// ======================================================

		const ns = url.searchParams.get('ns');
		const hostname = url.searchParams.get('hubhost') || url.hostname;
		const hostTop = hostname.split('.')[0]; 

		let checkHost; 
		if (ns) {
			if (ns === 'docker.io') { hub_host = 'registry-1.docker.io'; } 
            else { hub_host = ns; }
		} else {
			checkHost = routeByHosts(hostTop);
			hub_host = checkHost[0]; 
		}

		const fakePage = checkHost ? checkHost[1] : false; 
		url.hostname = hub_host;
		const hubParams = ['/v1/search', '/v1/repositories'];
		
        if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk)) && 屏蔽爬虫UA.length > 0) {
			return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		} else if ((userAgent && userAgent.includes('mozilla')) || hubParams.some(param => url.pathname.includes(param))) {
			if (url.pathname == '/') {
				if (env.URL302) { return Response.redirect(env.URL302, 302); } 
                else if (env.URL) {
					if (env.URL.toLowerCase() == 'nginx') {
						return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
					} else return fetch(new Request(env.URL, request));
				} else {
					if (fakePage) return new Response(await searchInterface(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
				}
			} else {
				if (url.pathname.startsWith('/v1/')) { url.hostname = 'index.docker.io'; } 
                else if (fakePage) { url.hostname = 'hub.docker.com'; }
				
                if (url.searchParams.get('q')?.includes('library/') && url.searchParams.get('q') != 'library/') {
					const search = url.searchParams.get('q');
					url.searchParams.set('q', search.replace('library/', ''));
				}
                // 移除调试模式，恢复正常代理请求
				return fetch(new Request(url, request));
			}
		}

		if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
			let modifiedUrl = url.toString().replace(/%3A(?=.*?&)/, '%3Alibrary%2F');
			url = new URL(modifiedUrl);
		}

		// 处理 token 请求
		if (url.pathname.includes('/token')) {
			let token_parameter = {
				headers: {
					'Host': 'auth.docker.io',
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0'
				}
			};
			
			// ========== [核心优化 2]：精准控制 Token 获取 ==========
			// 优先使用客户端自身的凭证；如果是匿名拉取，则注入环境变量中的账户凭证
			if (clientAuth) {
				token_parameter.headers['Authorization'] = clientAuth;
			} else if (basicAuthHeader) {
				token_parameter.headers['Authorization'] = basicAuthHeader;
			}
			// =======================================================

			let token_url = auth_url + url.pathname + url.search;
			return fetch(new Request(token_url, request), token_parameter);
		}

		if (hub_host == 'registry-1.docker.io' && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
			url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
		}

		// 拦截请求：先获取 token 再请求具体清单/数据
		if (
			url.pathname.startsWith('/v2/') &&
			(url.pathname.includes('/manifests/') || url.pathname.includes('/blobs/') || url.pathname.includes('/tags/') || url.pathname.endsWith('/tags/list'))
		) {
			let repo = '';
			const v2Match = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/);
			if (v2Match) repo = v2Match[1];
            
			if (repo) {
				const tokenUrl = `${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`;
				let fetchTokenHeaders = {
					'User-Agent': getReqHeader("User-Agent"),
					'Accept': getReqHeader("Accept"),
					'Accept-Language': getReqHeader("Accept-Language"),
					'Accept-Encoding': getReqHeader("Accept-Encoding"),
					'Connection': 'keep-alive',
					'Cache-Control': 'max-age=0'
				};

				// 如果配了环境变量，使用配置的账号去申请专属 token，跳出 IP 限制池
				if (basicAuthHeader) {
					fetchTokenHeaders['Authorization'] = basicAuthHeader;
				}

                // ========== [核心优化 3]：增强错误容错处理 ==========
				const tokenRes = await fetch(tokenUrl, { headers: fetchTokenHeaders });
				let token = "";
				if (tokenRes.ok) {
					const tokenData = await tokenRes.json();
					token = tokenData.token;
				} else {
					console.warn(`[WARN] 内部获取 Token 失败，状态码: ${tokenRes.status}`);
				}

				let parameter = {
					headers: {
						'Host': hub_host,
						'User-Agent': getReqHeader("User-Agent"),
						'Accept': getReqHeader("Accept"),
						'Accept-Language': getReqHeader("Accept-Language"),
						'Accept-Encoding': getReqHeader("Accept-Encoding"),
						'Connection': 'keep-alive',
						'Cache-Control': 'max-age=0'
					},
					cacheTtl: 3600
				};
				
                // 优先使用我们刚刚申请到的账号 token；如果申请失败，兜底尝试使用客户端自带的 token
				if (token) {
					parameter.headers['Authorization'] = `Bearer ${token}`;
				} else if (clientAuth) {
					parameter.headers['Authorization'] = clientAuth;
				}
                // =======================================================

				if (request.headers.has("X-Amz-Content-Sha256")) {
					parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
				}
				
				let original_response = await fetch(new Request(url, request), parameter);
				let original_response_clone = original_response.clone();
				let original_text = original_response_clone.body;
				let response_headers = original_response.headers;
				let new_response_headers = new Headers(response_headers);
				let status = original_response.status;
				
				if (new_response_headers.get("Www-Authenticate")) {
					let auth = new_response_headers.get("Www-Authenticate");
					let re = new RegExp(auth_url, 'g');
					new_response_headers.set("Www-Authenticate", response_headers.get("Www-Authenticate").replace(re, workers_url));
				}
				if (new_response_headers.get("Location")) {
					const location = new_response_headers.get("Location");
					return httpHandler(request, location, hub_host);
				}
				return new Response(original_text, { status, headers: new_response_headers });
			}
		}

		// 其他普通请求的兜底构造
		let parameter = {
			headers: {
				'Host': hub_host,
				'User-Agent': getReqHeader("User-Agent"),
				'Accept': getReqHeader("Accept"),
				'Accept-Language': getReqHeader("Accept-Language"),
				'Accept-Encoding': getReqHeader("Accept-Encoding"),
				'Connection': 'keep-alive',
				'Cache-Control': 'max-age=0'
			},
			cacheTtl: 3600
		};

		if (clientAuth) {
			parameter.headers.Authorization = clientAuth;
		}
		if (request.headers.has("X-Amz-Content-Sha256")) {
			parameter.headers['X-Amz-Content-Sha256'] = getReqHeader("X-Amz-Content-Sha256");
		}

		let original_response = await fetch(new Request(url, request), parameter);
		let original_response_clone = original_response.clone();
		let original_text = original_response_clone.body;
		let response_headers = original_response.headers;
		let new_response_headers = new Headers(response_headers);
		let status = original_response.status;

		if (new_response_headers.get("Www-Authenticate")) {
			let auth = new_response_headers.get("Www-Authenticate");
			let re = new RegExp(auth_url, 'g');
			new_response_headers.set("Www-Authenticate", response_headers.get("Www-Authenticate").replace(re, workers_url));
		}

		if (new_response_headers.get("Location")) {
			const location = new_response_headers.get("Location");
			return httpHandler(request, location, hub_host);
		}

		return new Response(original_text, { status, headers: new_response_headers });
	}
};

function httpHandler(req, pathname, baseHost) {
	const reqHdrRaw = req.headers;
	if (req.method === 'OPTIONS' && reqHdrRaw.has('access-control-request-headers')) {
		return new Response(null, PREFLIGHT_INIT);
	}
	let rawLen = '';
	const reqHdrNew = new Headers(reqHdrRaw);
	reqHdrNew.delete("Authorization"); 
	let urlStr = pathname;
	const urlObj = newUrl(urlStr, 'https://' + baseHost);
	const reqInit = {
		method: req.method,
		headers: reqHdrNew,
		redirect: 'follow',
		body: req.body
	};
	return proxy(urlObj, reqInit, rawLen);
}

async function proxy(urlObj, reqInit, rawLen) {
	const res = await fetch(urlObj.href, reqInit);
	const resHdrOld = res.headers;
	const resHdrNew = new Headers(resHdrOld);

	if (rawLen) {
		const newLen = resHdrOld.get('content-length') || '';
		if (rawLen !== newLen) {
			return makeRes(res.body, 400, { '--error': `bad len: ${newLen}, except: ${rawLen}`, 'access-control-expose-headers': '--error' });
		}
	}
	const status = res.status;
	resHdrNew.set('access-control-expose-headers', '*');
	resHdrNew.set('access-control-allow-origin', '*');
	resHdrNew.set('Cache-Control', 'max-age=1500');

	resHdrNew.delete('content-security-policy');
	resHdrNew.delete('content-security-policy-report-only');
	resHdrNew.delete('clear-site-data');

	return new Response(res.body, { status, headers: resHdrNew });
}

async function ADD(envadd) {
	var addtext = envadd.replace(/[	 |"'\r\n]+/g, ',').replace(/,+/g, ',');
	if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
	if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
	return addtext.split(',');
}
