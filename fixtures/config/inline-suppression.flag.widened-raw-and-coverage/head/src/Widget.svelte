<script lang="ts">
  export let count: number;
  // @ts-ignore
  export let label: string = count;
</script>

<p>{label}: {count}</p>
