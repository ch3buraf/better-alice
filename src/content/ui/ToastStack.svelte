<script>
  let { toasts = [] } = $props();
</script>

<div id="bap-toast-stack">
  {#each toasts as toast (toast.id)}
    <div class="bap-toast">{toast.message}</div>
  {/each}
</div>
