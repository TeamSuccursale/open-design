/** Read-only page location across an opaque preview iframe; does not grant DOM access to the host. */
export function blockoutDesignBridge(): string {
  return `<script data-od-blockout-design-bridge>(function(){
    window.addEventListener('message',function(event){
      var data=event.data;if(event.source!==parent||!data||data.type!=='od:blockout-visible-page-request'||typeof data.requestId!=='string')return;
      var best=null,area=0;
      document.querySelectorAll('[data-blockout-page-id]').forEach(function(node){
        var box=node.getBoundingClientRect(),visible=Math.max(0,Math.min(innerHeight,box.bottom)-Math.max(0,box.top))*Math.max(0,Math.min(innerWidth,box.right)-Math.max(0,box.left));
        if(visible>area){area=visible;best=node;}
      });
      parent.postMessage({type:'od:blockout-visible-page',requestId:data.requestId,pageId:best&&best.getAttribute('data-blockout-page-id'),documentId:best&&best.getAttribute('data-blockout-document-id')},'*');
    });
  })();</script>`;
}
