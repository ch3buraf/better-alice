// List ALL CDP targets including service workers, shared workers, iframes.
const tabs = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
console.log(JSON.stringify(tabs.map(t => ({type: t.type, url: t.url.slice(0, 100), title: t.title?.slice(0, 50)})), null, 2));
